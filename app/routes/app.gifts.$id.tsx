import { useState, type ReactNode } from "react";
import type { PreviewProduct } from "../modules/gifts/engine.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useFetcher,
  type ShouldRevalidateFunction,
} from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { canCreateCampaign } from "../models/plan.server";
import { getCampaign, saveCampaign } from "../models/gift-campaign.server";
import { fetchProductPrices } from "../models/addon-config.server";
import {
  emptyCampaign,
  campaignState,
  hasTrigger,
  triggerSummary,
  overlapWinners,
  rowToCampaign,
  rewardRule,
  giftQty,
  dealPct,
  rewardSummary,
  type GiftCampaign,
  type Ref,
} from "../models/gift-campaign";
import {
  GiftsShell,
  STATE_TONE,
  STATE_LABEL,
  statusSentence,
  fmtWhen,
} from "../modules/gifts/ui";
import { previewCoverage } from "../modules/gifts/engine.server";
import { listPool } from "../modules/gifts/pool.server";
import { listEvents } from "../modules/gifts/history.server";
import {
  PageHead,
  Panel,
  Field,
  Input,
  Select,
  Checkbox,
  Switch,
  Btn,
  Pill,
  Thumb,
  Banner,
} from "../ui/kit";

/** Existing brands / types / tags in the store, for the rule inputs. */
async function ruleSuggestions(admin: {
  graphql: (q: string) => Promise<Response>;
}): Promise<{ vendors: string[]; types: string[]; tags: string[] }> {
  try {
    const resp = await admin.graphql(`#graphql
      query GiftRuleSuggest {
        shop {
          productVendors(first: 250) { nodes }
          productTypes(first: 250) { nodes }
          productTags(first: 250) { nodes }
        }
      }`);
    const json: any = await resp.json();
    const list = (x: any) =>
      (Array.isArray(x?.nodes) ? x.nodes : []).filter(
        (v: unknown) => typeof v === "string" && v,
      );
    return {
      vendors: list(json?.data?.shop?.productVendors),
      types: list(json?.data?.shop?.productTypes),
      tags: list(json?.data?.shop?.productTags),
    };
  } catch {
    return { vendors: [], types: [], tags: [] };
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const id = params.id;
  let campaign: GiftCampaign | null = null;
  if (id && id !== "new") {
    campaign = await getCampaign(session.shop, id);
    if (!campaign) throw new Response("Not found", { status: 404 });
  }
  const c = campaign ?? emptyCampaign();
  // "New campaign with this gift" (from the gift pool): start with that gift.
  const seedGift = new URL(request.url).searchParams.get("gift");
  if (!campaign && seedGift && /^gid:\/\/shopify\/Product\/\d+$/.test(seedGift)) {
    const r = await admin.graphql(
      `#graphql
        query SeedGift($id: ID!) { product(id: $id) { id title handle featuredImage { url } } }`,
      { variables: { id: seedGift } },
    );
    const p = (await r.json())?.data?.product;
    if (p) {
      c.giftProducts = [
        { id: p.id, title: p.title, handle: p.handle, image: p.featuredImage?.url ?? null, qty: 1 },
      ];
      c.title = `Free ${p.title}`;
    }
  }
  // "Set up the discount" from the Promo Dashboard (联合推广, 2026-10-23): open a
  // NEW add-on deal already filled in — trigger = the compatible-products
  // collection, discounted = the promoted products' collection, the % and a title.
  // The merchant only reviews and saves.
  const sp = new URL(request.url).searchParams;
  if (!campaign && sp.get("deal") === "1") {
    const ids = [sp.get("trigger"), sp.get("reward")].filter((x): x is string => !!x && /^gid:\/\/shopify\/Collection\/\d+$/.test(x));
    const r = ids.length
      ? await admin.graphql(
          `#graphql
            query SeedDealCollections($ids: [ID!]!) { nodes(ids: $ids) { ... on Collection { id title handle image { url } } } }`,
          { variables: { ids } },
        )
      : null;
    const nodes: any[] = r ? ((await r.json())?.data?.nodes ?? []).filter(Boolean) : [];
    const ref = (id: string | null) => {
      const n = nodes.find((x) => x?.id === id);
      return n ? [{ id: n.id, title: n.title, handle: n.handle, image: n.image?.url ?? null }] : [];
    };
    c.kind = "deal";
    c.dealPercent = Math.min(99, Math.max(1, Math.round(Number(sp.get("pct"))) || 10));
    c.title = (sp.get("title") || "").slice(0, 120) || "Add-on deal";
    c.triggerCollections = ref(sp.get("trigger"));
    c.rewardCollections = ref(sp.get("reward"));
    // Variants whose options match these don't count (e.g. mirrorless mounts RF / L / X / Z).
    c.excludeOptions = (sp.get("exopt") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30);
    c.rewardMode = "all";
    c.badgeText = "";
    c.subtitle = "";
  }
  // Variants of each gift AND trigger product, so the editor can offer
  // per-variant selection on both sides.
  const productIds = [
    ...c.giftProducts.map((g) => g.id),
    ...c.triggerProducts.map((t) => t.id),
  ].filter(Boolean);
  const [variantMap, suggest] = await Promise.all([
    productIds.length
      ? fetchProductPrices(admin, productIds).then(
          (r) => r.variants as Record<string, { id: string; title: string }[]>,
        )
      : Promise.resolve({} as Record<string, { id: string; title: string }[]>),
    ruleSuggestions(admin),
  ]);
  // Products this campaign actually covers (from the gifts index, as of the
  // last sync) — rules like tags/brands expand to many products.
  const covers = campaign
    ? await prisma.giftCoverage.count({
        where: { shop: session.shop, campaignId: campaign.id, role: "trigger" },
      })
    : 0;
  // Other campaigns sharing trigger products with this one (overlaps).
  let overlaps: {
    id: string;
    title: string;
    state: string;
    priority: number;
    exclusive: boolean;
    products: number;
  }[] = [];
  if (campaign && covers) {
    const mine = await prisma.giftCoverage.findMany({
      where: { shop: session.shop, campaignId: campaign.id, role: "trigger" },
      select: { productId: true },
    });
    const shared = await prisma.giftCoverage.groupBy({
      by: ["campaignId"],
      where: {
        shop: session.shop,
        role: "trigger",
        campaignId: { not: campaign.id },
        productId: { in: mine.map((m) => m.productId) },
      },
      _count: { _all: true },
    });
    if (shared.length) {
      const others = await prisma.giftCampaign.findMany({
        where: { shop: session.shop, id: { in: shared.map((x) => x.campaignId) } },
      });
      overlaps = others.map((row) => {
        const o = rowToCampaign(row);
        return {
          id: o.id,
          title: o.title || "Untitled campaign",
          state: campaignState(o),
          priority: o.priority,
          exclusive: o.exclusive,
          products: shared.find((x) => x.campaignId === o.id)?._count._all ?? 0,
        };
      });
    }
  }
  const pool = (await listPool(session.shop)).map((p) => ({
    id: p.productId,
    title: p.title,
    handle: p.handle,
    image: p.image,
  }));
  const [times, history] = campaign
    ? await Promise.all([
        prisma.giftCampaign.findFirst({
          where: { shop: session.shop, id: campaign.id },
          select: { createdAt: true, updatedAt: true },
        }),
        listEvents(session.shop, campaign.id),
      ])
    : [null, []];
  return {
    campaign: c,
    isNew: !campaign,
    variantMap,
    suggest,
    covers,
    overlaps,
    pool,
    createdAt: times?.createdAt?.toISOString() ?? null,
    updatedAt: times?.updatedAt?.toISOString() ?? null,
    history,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  let campaign: GiftCampaign;
  try {
    campaign = JSON.parse(String(form.get("campaign")));
  } catch {
    return { ok: false, error: "Invalid payload" };
  }
  // Read-only coverage preview of the unsaved campaign.
  if (form.get("intent") === "preview") {
    if (!hasTrigger(campaign)) {
      return { ok: false, error: "Add a trigger first.", preview: null };
    }
    try {
      const preview = await previewCoverage(admin, session.shop, campaign);
      return { ok: true, error: null, preview };
    } catch (e) {
      return { ok: false, error: `Preview failed: ${(e as Error)?.message || e}`, preview: null };
    }
  }
  // Gate NEW campaigns only — editing an existing one is always allowed.
  const exists = campaign.id
    ? await prisma.giftCampaign.findFirst({
        where: { shop: session.shop, id: campaign.id },
        select: { id: true },
      })
    : null;
  if (!exists) {
    const gate = await canCreateCampaign(billing, session.shop);
    if (!gate.ok) return { ok: false, error: gate.error };
  }
  if (!hasTrigger(campaign)) {
    return {
      ok: false,
      error:
        "Add at least one trigger: products, collections, tags, brands, types or all products.",
    };
  }
  if (campaign.kind === "deal" ? campaign.giftProducts.length + (campaign.rewardCollections?.length ?? 0) === 0 : campaign.giftProducts.length === 0) {
    return { ok: false, error: campaign.kind === "deal" ? "Add at least one discounted product or collection." : "Add at least one gift product." };
  }
  // Saving also re-syncs product stamps and the gifts index.
  const r = await saveCampaign(admin, session.shop, campaign);
  if (!r.ok) return { ok: false, error: r.errors.join("; ") };
  return redirect("/app/gifts");
};

// A coverage preview is read-only — don't reload the loader after it.
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formData,
  defaultShouldRevalidate,
}) =>
  formData?.get("intent") === "preview" ? false : defaultShouldRevalidate;

function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export default function GiftCampaignEditor() {
  const {
    campaign: initial,
    isNew,
    variantMap: loadedVariants,
    suggest,
    covers,
    overlaps,
    pool,
    createdAt,
    updatedAt,
    history,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [c, setC] = useState<GiftCampaign>(initial);
  // Variants per product (gift + trigger); seeded from the loader, augmented
  // when picking.
  const [variantMap, setVariantMap] = useState<
    Record<string, { id: string; title: string }[]>
  >(loadedVariants || {});
  const [openVarPids, setOpenVarPids] = useState<Record<string, boolean>>({});
  const toggleVarOpen = (pid: string) =>
    setOpenVarPids((m) => ({ ...m, [pid]: !m[pid] }));
  const [showExclude, setShowExclude] = useState(false);
  const busy = fetcher.state !== "idle";
  const patch = (p: Partial<GiftCampaign>) => setC((cur) => ({ ...cur, ...p }));

  const pick = async (
    type: "product" | "collection",
    current: Ref[],
    onPick: (refs: Ref[]) => void,
  ) => {
    const picked = await shopify.resourcePicker({
      type,
      multiple: true,
      action: "select",
      selectionIds: current.map((r) => ({ id: r.id })),
    });
    if (!picked) return;
    const priorById = new Map(current.map((r) => [r.id, r]));
    const caps: Record<string, { id: string; title: string }[]> = {};
    onPick(
      picked.map((p: any) => {
        if (Array.isArray(p.variants) && p.variants.length) {
          caps[p.id] = p.variants
            .filter((v: any) => v?.id)
            .map((v: any) => ({ id: v.id, title: v.title || "" }));
        }
        const prior = priorById.get(p.id);
        return {
          id: p.id,
          title: p.title || "",
          handle: p.handle || "",
          image:
            p.images?.[0]?.originalSrc ??
            p.images?.[0]?.src ??
            p.image?.originalSrc ??
            p.image?.src ??
            null,
          // Keep any prior per-variant selection when re-opening the picker.
          variantIds: prior?.variantIds,
        };
      }),
    );
    if (Object.keys(caps).length) {
      setVariantMap((m) => ({ ...m, ...caps }));
    }
  };

  /** Collections: a plain list with remove. */
  const collectionList = (refs: Ref[], onChange: (next: Ref[]) => void) =>
    refs.length === 0 ? (
      <p className="kb-sub" style={{ margin: 0 }}>
        None selected
      </p>
    ) : (
      <div className="kb-refs">
        {refs.map((r) => (
          <div className="kb-ref" key={r.id}>
            <Thumb src={r.image} size={40} />
            <span className="kb-title" style={{ fontWeight: 500 }}>
              {r.title || r.handle || r.id}
            </span>
            <Btn
              size="tiny"
              variant="ghost"
              onClick={() => onChange(refs.filter((x) => x.id !== r.id))}
            >
              Remove
            </Btn>
          </div>
        ))}
      </div>
    );

  /**
   * Products with an optional per-variant chooser (trigger and gift sides).
   * All variants are offered when none are explicitly picked.
   */
  const refVariantList = (
    refs: Ref[],
    onChange: (next: Ref[]) => void,
    chipLabel: string,
    withQty = false,
  ) =>
    refs.length === 0 ? (
      <p className="kb-sub" style={{ margin: 0 }}>
        None selected
      </p>
    ) : (
      <div className="kb-refs">
        {refs.map((r) => {
          const vs = variantMap[r.id] || [];
          const offeredIds =
            r.variantIds && r.variantIds.length
              ? r.variantIds
              : vs.map((v) => v.id);
          const toggle = (vid: string) => {
            const next = offeredIds.includes(vid)
              ? offeredIds.filter((x) => x !== vid)
              : [...offeredIds, vid];
            if (next.length === 0) return; // keep at least one
            const variantIds = next.length === vs.length ? undefined : next;
            onChange(
              refs.map((x) => (x.id === r.id ? { ...x, variantIds } : x)),
            );
          };
          return (
            <div className="kb-ref" key={r.id}>
              <Thumb src={r.image} size={40} />
              <span className="kb-title" style={{ fontWeight: 500 }}>
                {r.title || r.handle || r.id}
              </span>
              <div className="kb-inline">
                {withQty ? (
                  <label className="kb-qty" title="How many of this gift per product bought">
                    Qty
                    <input
                      type="number"
                      min={1}
                      value={String(giftQty(r))}
                      onChange={(e) =>
                        onChange(
                          refs.map((x) =>
                            x.id === r.id
                              ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value)) || 1) }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                ) : null}
                {vs.length > 1 ? (
                  <Btn size="tiny" onClick={() => toggleVarOpen(r.id)}>
                    {`Variants ${offeredIds.length}/${vs.length} ${openVarPids[r.id] ? "▴" : "▾"}`}
                  </Btn>
                ) : null}
                <Btn
                  size="tiny"
                  variant="ghost"
                  onClick={() => onChange(refs.filter((x) => x.id !== r.id))}
                >
                  Remove
                </Btn>
              </div>
              {vs.length > 1 && openVarPids[r.id] ? (
                <div className="kb-ref__vars">
                  <span className="kb-sub">
                    {chipLabel} ({offeredIds.length}/{vs.length})
                  </span>
                  <div className="kb-chips">
                    {vs.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`kb-chip${offeredIds.includes(v.id) ? " is-on" : ""}`}
                        onClick={() => toggle(v.id)}
                      >
                        {v.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );

  const save = () =>
    fetcher.submit({ campaign: JSON.stringify(c) }, { method: "POST" });

  const state = campaignState(c) as keyof typeof STATE_LABEL;

  return (
    <GiftsShell>
      <PageHead
        back={{ to: "/app/gifts", label: "Campaigns" }}
        title={c.title || (isNew ? "New campaign" : "Untitled campaign")}
        subtitle={
          <span className="kb-inline">
            <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
            {!isNew ? (
              <Link
                to={`/app/gifts/products?campaign=${encodeURIComponent(c.id)}`}
                prefetch="intent"
                style={{ color: "var(--link)", fontWeight: 600 }}
              >
                {`Covers ${covers} product${covers === 1 ? "" : "s"}`}
              </Link>
            ) : null}
            {createdAt ? (
              <span className="kb-muted">
                {`Created ${fmtWhen(createdAt)}${updatedAt ? ` · last updated ${fmtWhen(updatedAt)}` : ""}`}
              </span>
            ) : null}
            <span>
              {`Triggers: ${triggerSummary(c)} · ${c.kind === "deal" ? rewardSummary(c) : `${c.giftProducts.length} gift${c.giftProducts.length === 1 ? "" : "s"}`}`}
            </span>
          </span>
        }
        actions={
          <>
            <Btn to="/app/gifts">Cancel</Btn>
            <Btn variant="primary" loading={busy} onClick={save}>
              Save campaign
            </Btn>
          </>
        }
      />

      {fetcher.data?.error ? (
        <Banner tone="danger">{fetcher.data.error}</Banner>
      ) : null}

      <div className="kb-grid-2">
        {/* ---- Main: what triggers it, what it gives ---- */}
        <div className="kb-stack">
          <Panel title="Campaign">
            <Field
              label="Campaign name"
              help="Internal name, e.g. “Buy a camera, get a free battery”."
            >
              <Input
                value={c.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
          </Panel>

          <Panel title="Trigger — buy any of these">
            <div className="kb-stack kb-stack--tight">
              <Switch
                label="All products in the store"
                checked={c.allProducts}
                onChange={(v) => patch({ allProducts: v })}
              />
              {!c.allProducts ? (
                <>
                  <ScopeSection
                    label={`Products (${c.triggerProducts.length})`}
                    action={
                      <Btn
                        size="tiny"
                        onClick={() =>
                          pick("product", c.triggerProducts, (refs) =>
                            patch({ triggerProducts: refs }),
                          )
                        }
                      >
                        + Add products
                      </Btn>
                    }
                  >
                    {c.triggerProducts.length
                      ? refVariantList(
                          c.triggerProducts,
                          (r) => patch({ triggerProducts: r }),
                          "Variants that qualify",
                        )
                      : null}
                  </ScopeSection>
                  <ScopeSection
                    label={`Collections (${c.triggerCollections.length})`}
                    action={
                      <Btn
                        size="tiny"
                        onClick={() =>
                          pick("collection", c.triggerCollections, (refs) =>
                            patch({ triggerCollections: refs }),
                          )
                        }
                      >
                        + Add collections
                      </Btn>
                    }
                  >
                    {c.triggerCollections.length
                      ? collectionList(c.triggerCollections, (r) =>
                          patch({ triggerCollections: r }),
                        )
                      : null}
                  </ScopeSection>
                  <FilterChips
                    idPrefix="trig"
                    tags={c.triggerTags}
                    vendors={c.triggerVendors}
                    types={c.triggerTypes}
                    suggest={suggest}
                    hint="Products matching any filter qualify — by tag, brand or product type."
                    onChange={(f) =>
                      patch({
                        triggerTags: f.tags,
                        triggerVendors: f.vendors,
                        triggerTypes: f.types,
                      })
                    }
                  />
                </>
              ) : null}

              <ExcludeBlock
                open={
                  showExclude ||
                  c.excludeProducts.length +
                    c.excludeCollections.length +
                    c.excludeTags.length +
                    c.excludeVendors.length +
                    c.excludeTypes.length +
                    (c.excludeOptions?.length ?? 0) >
                    0
                }
                onOpen={() => setShowExclude(true)}
              >
                <ScopeSection
                  label={`Products (${c.excludeProducts.length})`}
                  action={
                    <Btn
                      size="tiny"
                      onClick={() =>
                        pick("product", c.excludeProducts, (refs) =>
                          patch({
                            excludeProducts: refs.map(({ variantIds: _v, ...r }) => r),
                          }),
                        )
                      }
                    >
                      + Add products
                    </Btn>
                  }
                >
                  {c.excludeProducts.length
                    ? collectionList(c.excludeProducts, (r) => patch({ excludeProducts: r }))
                    : null}
                </ScopeSection>
                <ScopeSection
                  label={`Collections (${c.excludeCollections.length})`}
                  action={
                    <Btn
                      size="tiny"
                      onClick={() =>
                        pick("collection", c.excludeCollections, (refs) =>
                          patch({ excludeCollections: refs }),
                        )
                      }
                    >
                      + Add collections
                    </Btn>
                  }
                >
                  {c.excludeCollections.length
                    ? collectionList(c.excludeCollections, (r) =>
                        patch({ excludeCollections: r }),
                      )
                    : null}
                </ScopeSection>
                <FilterChips
                  idPrefix="ex"
                  tags={c.excludeTags}
                  vendors={c.excludeVendors}
                  types={c.excludeTypes}
                  suggest={suggest}
                  hint="Leave out products with any of these tags, brands or types."
                  onChange={(f) =>
                    patch({
                      excludeTags: f.tags,
                      excludeVendors: f.vendors,
                      excludeTypes: f.types,
                    })
                  }
                />
                <OptionValueChips
                  values={c.excludeOptions ?? []}
                  onChange={(v) => patch({ excludeOptions: v })}
                />
              </ExcludeBlock>
            </div>
          </Panel>

          <CoveragePreview c={c} isNew={isNew} />

          <Panel title={c.kind === "deal" ? `Discounted products — get ${dealPct(c)}% off` : "Gift — get free"}>
            <ScopeSection
              label={`${c.kind === "deal" ? "Discounted products" : "Gift products"} (${c.giftProducts.length})`}
              action={
                <Btn
                  size="tiny"
                  onClick={() =>
                    pick("product", c.giftProducts, (refs) =>
                      patch({ giftProducts: refs }),
                    )
                  }
                >
                  {c.kind === "deal" ? "+ Add products" : "+ Add gifts"}
                </Btn>
              }
            >
              {c.giftProducts.length
                ? refVariantList(
                    c.giftProducts,
                    (r) => patch({ giftProducts: r }),
                    c.kind === "deal" ? "Variants discounted" : "Variants offered free",
                    c.kind !== "deal",
                  )
                : null}
            </ScopeSection>
            {c.kind === "deal" ? (
              <ScopeSection
                label={`Collections (${c.rewardCollections.length})`}
                action={
                  <Btn
                    size="tiny"
                    onClick={() =>
                      pick("collection", c.rewardCollections, (refs) => patch({ rewardCollections: refs }))
                    }
                  >
                    + Add collections
                  </Btn>
                }
              >
                {c.rewardCollections.length ? (
                  collectionList(c.rewardCollections, (r) => patch({ rewardCollections: r }))
                ) : (
                  <p className="kb-sub" style={{ margin: 0 }}>
                    Every product (and every variant) in these collections is discounted too — products added to the
                    collection later join automatically.
                  </p>
                )}
              </ScopeSection>
            ) : null}
            {c.kind !== "deal" && pool.some((p) => !c.giftProducts.some((g) => g.id === p.id)) ? (
              <div className="kb-scope">
                <div className="kb-between">
                  <span className="kb-overline">From the gift pool</span>
                  <Link to="/app/gifts/items" prefetch="intent" className="kb-btn kb-btn--link kb-small">
                    Manage pool
                  </Link>
                </div>
                <div className="kb-chips" style={{ marginTop: 6 }}>
                  {pool
                    .filter((p) => !c.giftProducts.some((g) => g.id === p.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="kb-refchip kb-refchip--gift"
                        style={{ cursor: "pointer", font: "inherit" }}
                        title="Add as a gift"
                        onClick={() => patch({ giftProducts: [...c.giftProducts, { ...p, qty: 1 }] })}
                      >
                        <Thumb src={p.image} size={22} alt="" />
                        <span>{`+ ${p.title}`}</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        {/* ---- Sidebar: status, reward rule, storefront ---- */}
        <div className="kb-stack">
          <Panel title="Status">
            <div className="kb-stack kb-stack--tight">
              <div className="kb-between">
                <Select
                  style={{ width: "auto" }}
                  value={c.draft ? "draft" : c.enabled ? "published" : "paused"}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({ draft: v === "draft", enabled: v !== "paused" });
                  }}
                >
                  <option value="published">Published</option>
                  <option value="paused">Paused</option>
                  <option value="draft">Draft</option>
                </Select>
                <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
              </div>
              <div className="kb-sub">{statusSentence(c, state)}</div>
              <Field
                label="Starts (optional)"
                help="Blank = starts immediately."
              >
                <Input
                  type="datetime-local"
                  value={toLocalInput(c.startsAt)}
                  onChange={(e) =>
                    patch({ startsAt: fromLocalInput(e.target.value) })
                  }
                />
              </Field>
              <Field
                label="Ends (optional)"
                help="Starts and ends automatically at these times (the product page may take a minute to refresh)."
              >
                <Input
                  type="datetime-local"
                  value={toLocalInput(c.endsAt)}
                  onChange={(e) =>
                    patch({ endsAt: fromLocalInput(e.target.value) })
                  }
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Reward">
            <div className="kb-stack kb-stack--tight">
              <div className="kb-radios">
                {([
                  ["gift", "Free gift", "The reward products are free."],
                  ["deal", "Add-on deal (% off)", "The reward products get a discount when bought with a trigger product."],
                ] as const).map(([k, t, d]) => (
                  <label key={k} className={`kb-radio${c.kind === k ? " is-on" : ""}`}>
                    <input type="radio" name="kind" checked={c.kind === k} onChange={() => patch({ kind: k })} />
                    <span>
                      <b>{t}</b>
                      <span className="kb-sub">{d}</span>
                    </span>
                  </label>
                ))}
              </div>
              {c.kind === "deal" ? (
                <>
                  <Field label="Discount" help="Off each discounted product, at checkout.">
                    <div className="kb-inline" style={{ flexWrap: "nowrap" }}>
                      <Input
                        type="number"
                        min={1}
                        max={99}
                        style={{ width: 80 }}
                        value={String(c.dealPercent)}
                        onChange={(e) => patch({ dealPercent: Math.min(99, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })}
                      />
                      <span>% off</span>
                    </div>
                  </Field>
                  <div className="kb-box kb-small">
                    Each trigger product bought unlocks <b>one</b> discounted product (the most expensive one in the cart
                    first). It applies however the product was added — from its own page, a collection page or the
                    search — as long as a trigger product is in the same cart. Example: 2 lenses + 3 Smart Fusion kits →
                    2 kits get {dealPct(c)}% off.
                  </div>
                </>
              ) : (
                <RewardSettings c={c} patch={patch} legacyFixed={initial.rewardMode === "fixed"} />
              )}
            </div>
          </Panel>

          <Panel title="If a product is in several campaigns">
            <OverlapSettings c={c} patch={patch} overlaps={overlaps} />
          </Panel>

          {!isNew ? (
            <Panel title="History">
              {history.length ? (
                <div className="kb-history">
                  {history.map((h) => (
                    <div key={h.id} className="kb-history__item">
                      <div className="kb-between">
                        <b style={{ textTransform: "capitalize" }}>{h.action}</b>
                        <span className="kb-sub">{fmtWhen(h.at)}</span>
                      </div>
                      {h.lines.map((l, i) => (
                        <div key={i} className="kb-sub">
                          {l}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="kb-sub" style={{ margin: 0 }}>
                  No changes recorded yet — history starts from 16 Oct 2026. Before
                  that only the created / last updated times are known.
                </p>
              )}
            </Panel>
          ) : null}

          {c.kind === "deal" ? (
            <Panel title="Storefront">
              <p className="kb-sub" style={{ margin: 0 }}>
                Add-on deals don't add a picker to the product page — the discount is applied at checkout. Promote the
                deal with the product-page cards and landing page in the Promo Dashboard (联合推广).
              </p>
            </Panel>
          ) : (
          <Panel title="Storefront">
            <div className="kb-stack kb-stack--tight">
              <Field label="Badge text" help="Shown on product / search.">
                <Input
                  value={c.badgeText}
                  onChange={(e) => patch({ badgeText: e.target.value })}
                />
              </Field>
              <Field
                label="Picker prompt"
                help="Shown above the gift options on the product page. Customers can also pick “No thanks”."
              >
                <Input
                  value={c.subtitle}
                  placeholder="Choose your free gift:"
                  onChange={(e) => patch({ subtitle: e.target.value })}
                />
              </Field>
              <div>
                <Checkbox
                  label="Hide when sold out"
                  checked={c.hideWhenSoldOut}
                  onChange={(v) => patch({ hideWhenSoldOut: v })}
                />
                <div className="kb-sub" style={{ marginTop: 4 }}>
                  When on, a sold-out gift is hidden from the picker; if every
                  gift is sold out the whole group hides.
                </div>
              </div>
            </div>
          </Panel>
          )}
        </div>
      </div>
    </GiftsShell>
  );
}

/** Reward panel: how customers get gifts, how many, with a worked example. */
function RewardSettings({
  c,
  patch,
  legacyFixed,
}: {
  c: GiftCampaign;
  patch: (p: Partial<GiftCampaign>) => void;
  /** Saved with the retired "first gift only" mode — keep showing it. */
  legacyFixed: boolean;
}) {
  const n = c.giftProducts.length;
  const { k } = rewardRule(c);
  const modes: {
    value: GiftCampaign["rewardMode"];
    title: string;
    desc: string;
  }[] = [
    {
      value: "all",
      title: "Give every gift",
      desc: "All gifts are added automatically.",
    },
    {
      value: "choice",
      title: "Customer chooses",
      desc: "They pick which gift(s) they want.",
    },
  ];
  // "First gift only" is retired (it just hid every gift but the first — the
  // same as a campaign with one gift). Campaigns already saved with it keep it.
  if (legacyFixed)
    modes.push({
      value: "fixed",
      title: "First gift only (old mode)",
      desc: "Only the first gift is shown. Switch to another option to retire it.",
    });
  // Neutral labels keep the example short: "main product", "Gift 1", "Gift 2"…
  const qtys = c.giftProducts.map(giftQty);
  const example = (units: number) => {
    if (n === 0) return "add a gift product first";
    const list = (idx: number[]) => idx.map((i) => `${qtys[i] * units} × Gift ${i + 1}`).join(" + ");
    if (c.rewardMode === "all" || n === 1) return list(qtys.map((_, i) => i));
    if (c.rewardMode === "fixed") return list([0]);
    const each = units === 1 ? "each at its Qty" : `${units} × each gift's Qty`;
    return `${k} gift${k === 1 ? "" : "s"} of their choice (${each})`;
  };

  return (
    <div className="kb-stack kb-stack--tight">
      <div className="kb-lfield__label">How do customers get gifts?</div>
      {n <= 1 ? (
        <div className="kb-box kb-small">
          {n === 0
            ? "Add gift products first — then choose how they're given."
            : "One gift: the customer gets it with every product bought. Add more gifts to let customers choose, or give them all."}
        </div>
      ) : (
        <div className="kb-radios">
          {modes.map((m) => (
            <label
              key={m.value}
              className={`kb-radio${c.rewardMode === m.value ? " is-on" : ""}`}
            >
              <input
                type="radio"
                name="rewardMode"
                checked={c.rewardMode === m.value}
                onChange={() => patch({ rewardMode: m.value })}
              />
              <span>
                <b>{m.title}</b>
                <span className="kb-sub">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {c.rewardMode === "choice" && n > 1 ? (
        <Field label="How many can they choose?">
          <div className="kb-inline" style={{ flexWrap: "nowrap" }}>
            <Input
              type="number"
              min={1}
              max={n}
              style={{ width: 80 }}
              value={String(c.chooseCount)}
              onChange={(e) =>
                patch({
                  chooseCount: Math.min(
                    n,
                    Math.max(1, Math.floor(Number(e.target.value)) || 1),
                  ),
                })
              }
            />
            <span className="kb-sub">{`of ${n} gifts`}</span>
          </div>
        </Field>
      ) : null}

      <div className="kb-box kb-small">
        <div className="kb-overline" style={{ marginBottom: 6 }}>
          Example
        </div>
        <div>
          Buys 1 × main product → gets <b>{example(1)}</b> free
        </div>
        <div style={{ marginTop: 4 }}>
          Buys 2 × main product → gets <b>{example(2)}</b> free
        </div>
        {n > 1 ? (
          <div className="kb-muted" style={{ marginTop: 6 }}>
            Gift 1, Gift 2… follow the order of the gift list. Set each gift&apos;s
            quantity with its Qty box.
          </div>
        ) : (
          <div className="kb-muted" style={{ marginTop: 6 }}>
            Set the quantity with the gift&apos;s Qty box.
          </div>
        )}
      </div>
    </div>
  );
}

/** Overlap settings: combine switch, priority, and who wins against whom. */
function OverlapSettings({
  c,
  patch,
  overlaps,
}: {
  c: GiftCampaign;
  patch: (p: Partial<GiftCampaign>) => void;
  overlaps: {
    id: string;
    title: string;
    state: string;
    priority: number;
    exclusive: boolean;
    products: number;
  }[];
}) {
  // Pairwise outcome with the edits on screen (ties: the older campaign ranks
  // first at checkout; here we only know it's a tie).
  const outcome = (o: (typeof overlaps)[number]) => {
    const me = { id: "me", priority: c.priority, exclusive: c.exclusive };
    const them = { id: "them", priority: o.priority, exclusive: o.exclusive };
    if (!me.exclusive && !them.exclusive) return "Both gifts are given";
    if (me.priority === them.priority) return "Same priority — the older campaign wins";
    const win = overlapWinners([me, them]);
    if (win.length === 2) return "Both gifts are given";
    return win[0].id === "me" ? "This campaign wins" : `“${o.title}” wins`;
  };
  return (
    <div className="kb-stack kb-stack--tight">
      <Switch
        label="Combine with other gift campaigns"
        checked={!c.exclusive}
        onChange={(v) => patch({ exclusive: !v })}
      />
      <div className="kb-sub">
        {c.exclusive
          ? "Exclusive: on a product that's also in other campaigns, customers get either this campaign's gift or the other one — never both. Priority decides which."
          : "On a product that's also in other campaigns, customers get every campaign's gifts (unless one of them is exclusive)."}
      </div>
      <Field label="Priority" help="Higher number wins when campaigns don't combine.">
        <Input
          type="number"
          style={{ width: 100 }}
          value={String(c.priority)}
          onChange={(e) => patch({ priority: Math.trunc(Number(e.target.value) || 0) })}
        />
      </Field>
      {overlaps.length ? (
        <div className="kb-box kb-small">
          <div className="kb-overline" style={{ marginBottom: 6 }}>
            Shares products with
          </div>
          {overlaps.map((o) => (
            <div key={o.id} style={{ marginBottom: 6 }}>
              <Link
                to={`/app/gifts/${o.id}`}
                prefetch="intent"
                style={{ color: "var(--link)", fontWeight: 600 }}
              >
                {o.title}
              </Link>
              <span className="kb-muted">
                {` · ${o.products} product${o.products === 1 ? "" : "s"} · ${o.state}${
                  o.exclusive ? " · exclusive" : ""
                } · priority ${o.priority}`}
              </span>
              <div>{outcome(o)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="kb-sub">No other campaign shares products with this one.</div>
      )}
    </div>
  );
}

/** Trigger fields only — a change here makes a preview stale. */
const triggerKey = (c: GiftCampaign) =>
  JSON.stringify([
    c.triggerProducts.map((p) => p.id),
    c.triggerCollections.map((p) => p.id),
    c.triggerTags,
    c.triggerVendors,
    c.triggerTypes,
    c.allProducts,
    c.excludeTags,
    c.excludeProducts.map((p) => p.id),
    c.excludeCollections.map((p) => p.id),
    c.excludeVendors,
    c.excludeTypes,
    c.excludeOptions ?? [],
  ]);

type PreviewResult = {
  total: number;
  added: number;
  removed: number;
  products: PreviewProduct[];
  removedTitles: string[];
};

/** "Which products will this cover?" — resolved server-side before saving. */
function CoveragePreview({ c, isNew }: { c: GiftCampaign; isNew: boolean }) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null; preview?: PreviewResult | null }>();
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;
  const p = data?.preview ?? null;
  const stale = p && checkedKey !== triggerKey(c);
  const run = () => {
    setCheckedKey(triggerKey(c));
    fetcher.submit(
      { intent: "preview", campaign: JSON.stringify(c) },
      { method: "POST" },
    );
  };
  return (
    <Panel
      title="Coverage preview"
      actions={
        <Btn size="tiny" variant={p && !stale ? "default" : "primary"} loading={busy} onClick={run}>
          {p ? "Preview again" : "Preview products"}
        </Btn>
      }
    >
      {!p && !data?.error ? (
        <p className="kb-sub" style={{ margin: 0 }}>
          See exactly which products these triggers cover — before you save.
          Nothing changes until you click Save campaign.
        </p>
      ) : null}
      {data?.error ? <Banner tone="danger">{data.error}</Banner> : null}
      {p ? (
        <div className="kb-stack kb-stack--tight">
          {stale ? (
            <Banner tone="warn">Triggers changed since this preview — preview again.</Banner>
          ) : null}
          <div className="kb-inline" style={{ gap: 8 }}>
            <b style={{ fontSize: 15 }}>{`${p.total} product${p.total === 1 ? "" : "s"}`}</b>
            {!isNew ? (
              <>
                {p.added ? <Pill tone="ok">{`+${p.added} new`}</Pill> : null}
                {p.removed ? <Pill tone="danger">{`−${p.removed} removed`}</Pill> : null}
                {!p.added && !p.removed ? <Pill>No change from saved</Pill> : null}
              </>
            ) : null}
          </div>
          {p.removed ? (
            <div className="kb-box kb-small">
              <b>Will stop giving the gift:</b>{" "}
              {p.removedTitles.join(", ")}
              {p.removed > p.removedTitles.length
                ? ` and ${p.removed - p.removedTitles.length} more`
                : ""}
            </div>
          ) : null}
          {p.products.length ? (
            <div className="kb-refs" style={{ maxHeight: 420, overflowY: "auto" }}>
              {p.products.map((x) => (
                <div className="kb-ref" key={x.productId}>
                  <Thumb src={x.image} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div className="kb-inline" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <span className="kb-title" style={{ fontWeight: 500 }}>
                        {x.title}
                      </span>
                      {x.isNew && !isNew ? <Pill tone="ok">New</Pill> : null}
                      {x.status && x.status !== "ACTIVE" ? (
                        <Pill tone="warn">{x.status.toLowerCase()}</Pill>
                      ) : null}
                    </div>
                    <div className="kb-sub">
                      {[x.vendor, x.via.join(" · ")].filter(Boolean).join(" — ")}
                    </div>
                  </div>
                  <span />
                </div>
              ))}
            </div>
          ) : (
            <p className="kb-sub" style={{ margin: 0 }}>
              No products match these triggers.
            </p>
          )}
          {p.total > p.products.length ? (
            <div className="kb-sub">{`Showing ${p.products.length} of ${p.total}.`}</div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/** A labelled row inside the trigger / exclude builder, button on the right. */
function ScopeSection({
  label,
  action,
  children,
}: {
  label: string;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="kb-scope">
      <div className="kb-between">
        <span className="kb-overline">{label}</span>
        {action}
      </div>
      {children ? <div style={{ marginTop: 4 }}>{children}</div> : null}
    </div>
  );
}

/** Exclusions: a single link until used, then the same builder as triggers. */
function ExcludeBlock({
  open,
  onOpen,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return (
      <div className="kb-exclude kb-exclude--closed">
        <Btn size="tiny" variant="link" onClick={onOpen}>
          + Exclude products, collections, tags, brands or types
        </Btn>
      </div>
    );
  }
  return (
    <div className="kb-exclude">
      <div className="kb-exclude__title">
        Exclude
        <span className="kb-sub">
          {" "}
          — leaves products out of collections, filters and All products. Products
          added directly above always qualify.
        </span>
      </div>
      <div className="kb-stack kb-stack--tight">{children}</div>
    </div>
  );
}

type FilterKind = "tag" | "vendor" | "type";
const FILTER_LABEL: Record<FilterKind, string> = { tag: "Tag", vendor: "Brand", type: "Type" };

/** Tag / brand / type conditions as removable chips with one "Add filter" row. */
/**
 * Variant carve-out: option values (e.g. mirrorless mounts "RF", "L", "X", "Z")
 * whose variants don't count. The product still qualifies with its other variants.
 */
function OptionValueChips({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    const parts = value.split(",").map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setValue("");
  };
  return (
    <div className="kb-scope">
      <div className="kb-between">
        <span className="kb-overline">{`Variants with these option values (${values.length})`}</span>
      </div>
      {values.length ? (
        <div className="kb-chips" style={{ marginTop: 6 }}>
          {values.map((v) => (
            <span key={v} className="kb-token">
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="kb-filteradd">
        <Input
          value={value}
          placeholder="e.g. RF, L, X, Z — press Enter"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Btn size="tiny" variant="primary" onClick={add}>
          Add
        </Btn>
      </div>
      <p className="kb-sub" style={{ marginTop: 4 }}>
        A product&apos;s variants whose options include any of these (e.g. mirrorless mounts) don&apos;t qualify —
        the product still qualifies with its other variants. &ldquo;Mount&rdquo; is ignored, so RF matches &ldquo;RF Mount&rdquo;.
      </p>
    </div>
  );
}

function FilterChips({
  idPrefix,
  tags,
  vendors,
  types,
  suggest,
  hint,
  onChange,
}: {
  idPrefix: string;
  tags: string[];
  vendors: string[];
  types: string[];
  suggest: { tags: string[]; vendors: string[]; types: string[] };
  hint: string;
  onChange: (f: { tags: string[]; vendors: string[]; types: string[] }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<FilterKind>("tag");
  const [value, setValue] = useState("");
  const current = { tags, vendors, types };
  const listKey = { tag: "tags", vendor: "vendors", type: "types" } as const;
  const chips = [
    ...tags.map((v) => ({ kind: "tag" as FilterKind, v })),
    ...vendors.map((v) => ({ kind: "vendor" as FilterKind, v })),
    ...types.map((v) => ({ kind: "type" as FilterKind, v })),
  ];
  const add = () => {
    const v = value.trim();
    if (!v) return;
    const k = listKey[kind];
    if (!current[k].some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange({ ...current, [k]: [...current[k], v] });
    }
    setValue("");
  };
  const remove = (k: FilterKind, v: string) =>
    onChange({ ...current, [listKey[k]]: current[listKey[k]].filter((x) => x !== v) });
  const options = suggest[listKey[kind]];
  return (
    <div className="kb-scope">
      <div className="kb-between">
        <span className="kb-overline">{`Filters (${chips.length})`}</span>
        {!adding ? (
          <Btn size="tiny" onClick={() => setAdding(true)}>
            + Add filter
          </Btn>
        ) : null}
      </div>
      {chips.length ? (
        <div className="kb-chips" style={{ marginTop: 6 }}>
          {chips.map((ch) => (
            <span key={`${ch.kind}:${ch.v}`} className="kb-token">
              <span className="kb-muted">{FILTER_LABEL[ch.kind]}:</span>&nbsp;{ch.v}
              <button type="button" aria-label={`Remove ${ch.v}`} onClick={() => remove(ch.kind, ch.v)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : !adding ? (
        <div className="kb-sub" style={{ marginTop: 2 }}>{hint}</div>
      ) : null}
      {adding ? (
        <div className="kb-filteradd">
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as FilterKind)}
            style={{ width: 130 }}
          >
            <option value="tag">Tag</option>
            <option value="vendor">Brand</option>
            <option value="type">Product type</option>
          </Select>
          <Input
            list={`${idPrefix}-${kind}-list`}
            value={value}
            placeholder={kind === "tag" ? "e.g. sale" : kind === "vendor" ? "e.g. DZOFILM" : "e.g. Cine Lens"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <datalist id={`${idPrefix}-${kind}-list`}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <Btn size="tiny" variant="primary" onClick={add}>
            Add
          </Btn>
          <Btn size="tiny" variant="ghost" onClick={() => setAdding(false)}>
            Done
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
