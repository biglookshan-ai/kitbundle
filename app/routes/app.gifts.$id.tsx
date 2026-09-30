import { useState } from "react";
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
  type GiftCampaign,
  type Ref,
} from "../models/gift-campaign";
import {
  GiftsShell,
  STATE_TONE,
  STATE_LABEL,
  statusSentence,
} from "../modules/gifts/ui";
import { previewCoverage } from "../modules/gifts/engine.server";
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
  TokenInput,
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
  return { campaign: c, isNew: !campaign, variantMap, suggest, covers, overlaps };
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
  if (campaign.giftProducts.length === 0) {
    return { ok: false, error: "Add at least one gift product." };
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
            <span>
              {`Triggers: ${triggerSummary(c)} · ${c.giftProducts.length} gift${c.giftProducts.length === 1 ? "" : "s"}`}
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

          <Panel
            title="Trigger — buy any of these"
            actions={
              <Btn
                size="tiny"
                onClick={() =>
                  pick("product", c.triggerProducts, (refs) =>
                    patch({ triggerProducts: refs }),
                  )
                }
              >
                Select products
              </Btn>
            }
          >
            <div className="kb-overline" style={{ marginBottom: 4 }}>
              {`Products (${c.triggerProducts.length})`}
            </div>
            {refVariantList(
              c.triggerProducts,
              (r) => patch({ triggerProducts: r }),
              "Variants that qualify",
            )}
            <div className="kb-divider" />
            <div className="kb-between" style={{ marginBottom: 4 }}>
              <span className="kb-overline">{`Collections (${c.triggerCollections.length})`}</span>
              <Btn
                size="tiny"
                onClick={() =>
                  pick("collection", c.triggerCollections, (refs) =>
                    patch({ triggerCollections: refs }),
                  )
                }
              >
                Select collections
              </Btn>
            </div>
            {collectionList(c.triggerCollections, (r) =>
              patch({ triggerCollections: r }),
            )}

            <div className="kb-divider" />
            <div className="kb-overline" style={{ marginBottom: 8 }}>
              Rules
            </div>
            <div className="kb-stack kb-stack--tight">
              <Switch
                label="All products — every product in the store"
                checked={c.allProducts}
                onChange={(v) => patch({ allProducts: v })}
              />
              {!c.allProducts ? (
                <>
                  <Field
                    label="Product tags"
                    help="Products with any of these tags."
                  >
                    <TokenInput
                      id="trig-tags"
                      values={c.triggerTags}
                      onChange={(v) => patch({ triggerTags: v })}
                      placeholder="Type a tag and press Enter"
                      suggestions={suggest.tags}
                    />
                  </Field>
                  <Field
                    label="Brands (vendor)"
                    help="Products from any of these brands."
                  >
                    <TokenInput
                      id="trig-vendors"
                      values={c.triggerVendors}
                      onChange={(v) => patch({ triggerVendors: v })}
                      placeholder="e.g. DZOFILM"
                      suggestions={suggest.vendors}
                    />
                  </Field>
                  <Field
                    label="Product types"
                    help="Products of any of these types."
                  >
                    <TokenInput
                      id="trig-types"
                      values={c.triggerTypes}
                      onChange={(v) => patch({ triggerTypes: v })}
                      placeholder="e.g. Cine Lens"
                      suggestions={suggest.types}
                    />
                  </Field>
                </>
              ) : null}
            </div>

            <div className="kb-divider" />
            <div className="kb-between" style={{ marginBottom: 4 }}>
              <span className="kb-overline">Exclude</span>
              <Btn
                size="tiny"
                onClick={() =>
                  pick("product", c.excludeProducts, (refs) =>
                    patch({
                      excludeProducts: refs.map(
                        ({ variantIds: _v, ...r }) => r,
                      ),
                    }),
                  )
                }
              >
                Select products
              </Btn>
            </div>
            <p className="kb-sub" style={{ margin: "0 0 8px" }}>
              Carves products out of collections, tags, brands, types and All
              products. Products listed directly above always qualify.
            </p>
            <div className="kb-stack kb-stack--tight">
              <Field label="Exclude products with these tags">
                <TokenInput
                  id="ex-tags"
                  values={c.excludeTags}
                  onChange={(v) => patch({ excludeTags: v })}
                  placeholder="e.g. clearance"
                  suggestions={suggest.tags}
                />
              </Field>
              {collectionList(c.excludeProducts, (r) =>
                patch({ excludeProducts: r }),
              )}
            </div>
          </Panel>

          <CoveragePreview c={c} isNew={isNew} />

          <Panel
            title="Gift — get free"
            actions={
              <Btn
                size="tiny"
                onClick={() =>
                  pick("product", c.giftProducts, (refs) =>
                    patch({ giftProducts: refs }),
                  )
                }
              >
                Select gifts
              </Btn>
            }
          >
            <div className="kb-overline" style={{ marginBottom: 4 }}>
              {`Gift products (${c.giftProducts.length})`}
            </div>
            {refVariantList(
              c.giftProducts,
              (r) => patch({ giftProducts: r }),
              "Variants offered free",
            )}
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
                help="Starts and ends automatically, within about 10 minutes of these times."
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
            <RewardSettings c={c} patch={patch} legacyFixed={initial.rewardMode === "fixed"} />
          </Panel>

          <Panel title="If a product is in several campaigns">
            <OverlapSettings c={c} patch={patch} overlaps={overlaps} />
          </Panel>

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
  const { k, q } = rewardRule(c);
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
  const buyer = c.triggerProducts[0]?.title || "a qualifying product";
  const name = (i: number) => c.giftProducts[i]?.title || `Gift ${i + 1}`;
  const example = (units: number) => {
    const each = q * units;
    if (n === 0) return "Add a gift product first.";
    if (c.rewardMode === "all" || n === 1) {
      return c.giftProducts.map((_, i) => `${each} × ${name(i)}`).join(" + ");
    }
    if (c.rewardMode === "fixed") return `${each} × ${name(0)}`;
    return k === 1
      ? `${each} × one gift they choose from ${n}`
      : `${each} of each of ${k} gifts they choose from ${n}`;
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

      <Field label="Gift quantity">
        <div className="kb-inline" style={{ flexWrap: "nowrap" }}>
          <Input
            type="number"
            min={1}
            style={{ width: 80 }}
            value={String(c.perQualifying)}
            onChange={(e) =>
              patch({
                perQualifying: Math.max(
                  1,
                  Math.floor(Number(e.target.value)) || 1,
                ),
              })
            }
          />
          <span className="kb-sub">of each gift, for every product bought</span>
        </div>
      </Field>

      <div className="kb-box kb-small">
        <div className="kb-overline" style={{ marginBottom: 6 }}>
          Example
        </div>
        <div>
          Buys 1 × {buyer} → gets <b>{example(1)}</b> free
        </div>
        <div style={{ marginTop: 4 }}>
          Buys 2 → gets <b>{example(2)}</b> free
        </div>
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
