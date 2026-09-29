import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData, useFetcher } from "@remix-run/react";
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
  rewardRule,
  type GiftCampaign,
  type Ref,
} from "../models/gift-campaign";
import { GiftsShell, STATE_TONE, STATE_LABEL } from "../modules/gifts/ui";
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
  return { campaign: c, isNew: !campaign, variantMap, suggest, covers };
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
        <div className="kb-stack kb-sticky">
          <Panel title="Status">
            <div className="kb-stack kb-stack--tight">
              <div className="kb-between">
                <Switch
                  label="Enabled"
                  checked={c.enabled}
                  onChange={(v) => patch({ enabled: v })}
                />
                <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
              </div>
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
              <Field label="Ends (optional)" help="Server-enforced end.">
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
            <RewardSettings c={c} patch={patch} />
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
}: {
  c: GiftCampaign;
  patch: (p: Partial<GiftCampaign>) => void;
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
    {
      value: "fixed",
      title: "First gift only",
      desc: "Only the first gift in the list is given.",
    },
  ];
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
