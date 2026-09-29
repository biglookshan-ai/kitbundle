import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { canCreateCampaign } from "../models/plan.server";
import { getCampaign, saveCampaign } from "../models/gift-campaign.server";
import { fetchProductPrices } from "../models/addon-config.server";
import { rebuildCoverage } from "../modules/gifts/coverage.server";
import {
  emptyCampaign,
  campaignState,
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
} from "../ui/kit";

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
  let variantMap: Record<string, { id: string; title: string }[]> = {};
  if (productIds.length) {
    const { variants } = await fetchProductPrices(admin, productIds);
    variantMap = variants as Record<string, { id: string; title: string }[]>;
  }
  return { campaign: c, isNew: !campaign, variantMap };
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
  if (
    campaign.triggerProducts.length === 0 &&
    campaign.triggerCollections.length === 0
  ) {
    return { ok: false, error: "Add at least one trigger product or collection." };
  }
  if (campaign.giftProducts.length === 0) {
    return { ok: false, error: "Add at least one gift product." };
  }
  const r = await saveCampaign(admin, session.shop, campaign);
  // Keep the gifts index (products / gifts / brands views) in step. Best
  // effort — a failure here must never block saving the campaign itself.
  await rebuildCoverage(admin, session.shop, [campaign.id]).catch(() => {});
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
  const { campaign: initial, isNew, variantMap: loadedVariants } =
    useLoaderData<typeof loader>();
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
            onChange(refs.map((x) => (x.id === r.id ? { ...x, variantIds } : x)));
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
            <span>
              {`${c.triggerProducts.length + c.triggerCollections.length} trigger${
                c.triggerProducts.length + c.triggerCollections.length === 1 ? "" : "s"
              } → ${c.giftProducts.length} gift${c.giftProducts.length === 1 ? "" : "s"}`}
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

      {fetcher.data?.error ? <Banner tone="danger">{fetcher.data.error}</Banner> : null}

      <div className="kb-grid-2">
        {/* ---- Main: what triggers it, what it gives ---- */}
        <div className="kb-stack">
          <Panel title="Campaign">
            <Field
              label="Campaign name"
              help="Internal name, e.g. “Buy a camera, get a free battery”."
            >
              <Input value={c.title} onChange={(e) => patch({ title: e.target.value })} />
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
            {collectionList(c.triggerCollections, (r) => patch({ triggerCollections: r }))}
          </Panel>

          <Panel
            title="Gift — get free"
            actions={
              <Btn
                size="tiny"
                onClick={() =>
                  pick("product", c.giftProducts, (refs) => patch({ giftProducts: refs }))
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
              <Field label="Starts (optional)" help="Blank = starts immediately.">
                <Input
                  type="datetime-local"
                  value={toLocalInput(c.startsAt)}
                  onChange={(e) => patch({ startsAt: fromLocalInput(e.target.value) })}
                />
              </Field>
              <Field label="Ends (optional)" help="Server-enforced end.">
                <Input
                  type="datetime-local"
                  value={toLocalInput(c.endsAt)}
                  onChange={(e) => patch({ endsAt: fromLocalInput(e.target.value) })}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Reward">
            <div className="kb-stack kb-stack--tight">
              <Field label="Reward mode">
                <Select
                  value={c.rewardMode}
                  onChange={(e) =>
                    patch({ rewardMode: e.target.value as "fixed" | "choice" | "all" })
                  }
                >
                  <option value="fixed">Fixed — auto-add the first gift</option>
                  <option value="choice">Choice — customer picks one gift</option>
                  <option value="all">All — auto-add every gift</option>
                </Select>
              </Field>
              <Field
                label="Free per qualifying unit"
                help={
                  c.rewardMode === "all"
                    ? "Not used in All mode: every gift is given once per qualifying item (buy 2 → 2 of each)."
                    : `Buy 1 → get ${c.perQualifying} free per qualifying item.`
                }
              >
                <Input
                  type="number"
                  min={1}
                  value={String(c.perQualifying)}
                  disabled={c.rewardMode === "all"}
                  onChange={(e) =>
                    patch({ perQualifying: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </Field>
            </div>
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
                  When on, a sold-out gift is hidden from the picker; if every gift
                  is sold out the whole group hides.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </GiftsShell>
  );
}
