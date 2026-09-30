import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData, useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { canConfigureProduct } from "../models/plan.server";
import {
  readConfig,
  saveConfig,
  fetchProductPrices,
} from "../models/addon-config.server";
import {
  reconcileLimitedOffers,
  checkLimitedOfferNodes,
} from "../models/limited-offer.server";
import { getProductGiftInfo } from "../models/gift-campaign.server";
import type { ProductGiftInfo } from "../models/gift-campaign";
import {
  newGroupId,
  newOfferId,
  normalizeCode,
  clampPercent,
  displayCode,
  formLabel,
  effectiveAccessoryPercent,
  type AddonConfig,
  type AddonGroup,
  type AddonAccessory,
  type LimitedOffer,
} from "../models/addon-config";
import { OffersShell } from "../components/OfferList";
import {
  PageHead,
  Btn,
  IconBtn,
  Banner,
  Panel,
  Pill,
  Thumb,
  Empty,
  List,
  Row,
  Segmented,
  Input,
  AffixInput,
  Select,
  Checkbox,
  sized,
} from "../ui/kit";
import {
  IconArchive,
  IconChevron,
  IconDrag,
  IconEye,
  IconEyeOff,
  IconHelp,
  IconPlus,
  IconTrash,
} from "../ui/icons";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.id}`;
  const { product, config } = await readConfig(admin, productId);
  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }

  // The MAIN product's full image gallery — merchants usually upload the kit /
  // installation "demo" shots here, so those are the natural bundle covers.
  const imgResp = await admin.graphql(
    `#graphql
      query MainImages($id: ID!) {
        product(id: $id) { images(first: 40) { nodes { url altText } } }
      }`,
    { variables: { id: productId } },
  );
  const imgJson = await imgResp.json();
  const mainImages: { url: string; alt: string }[] = (
    imgJson?.data?.product?.images?.nodes ?? []
  )
    .map((n: any) => ({ url: n?.url as string, alt: (n?.altText as string) || "" }))
    .filter((n: { url: string }) => !!n.url);
  const ids = [
    product.id,
    ...config.groups.flatMap((g) => g.accessories.map((a) => a.productId)),
  ];
  const { prices, compareAt, variants, info, inventory, currency } =
    await fetchProductPrices(admin, ids);

  // Self-heal: a limited offer's time-gated discount node can go missing (e.g. it
  // was created before the Function was deployed), which silently charges the base
  // price. Check node status on load; if any is missing, re-run reconcile to
  // recreate it and re-check. The healthy path stays read-only (no writes).
  let offerHealError: string | null = null;
  let offerStatus = await checkLimitedOfferNodes(admin, product, config);
  const missing = Object.values(offerStatus).some((s) => !s.hasNode);
  if (missing) {
    const heal = await reconcileLimitedOffers(admin, product, config);
    if (heal.userErrors.length > 0) offerHealError = heal.userErrors.join("; ");
    offerStatus = await checkLimitedOfferNodes(admin, product, config);
  }

  // ④ Which gift campaigns give a free gift when this product is bought.
  const giftInfo = await getProductGiftInfo(admin, session.shop, product.id);

  return {
    product,
    mainImages,
    config,
    prices,
    compareAt,
    variants,
    info,
    inventory,
    currency,
    offerStatus,
    offerHealError,
    giftInfo,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.id}`;

  const gate = await canConfigureProduct(billing, session.shop, productId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const formData = await request.formData();
  const raw = String(formData.get("config") ?? "");
  let parsed: AddonConfig;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid configuration payload." };
  }

  const { product } = await readConfig(admin, productId);
  if (!product) return { ok: false, error: "Product not found." };

  parsed.groups = (parsed.groups ?? []).map((g) => {
    const base: AddonGroup = {
      ...g,
      code: normalizeCode(g.code),
      discountPercent:
        g.type === "free" ? 100 : clampPercent(g.discountPercent),
    };
    if (g.type === "bundle" && g.limited) {
      const enabled = Boolean(g.limited.enabled);
      base.limited = {
        enabled,
        discountPercent: clampPercent(g.limited.discountPercent),
        mode: g.limited.mode === "end" ? "end" : "revert",
        startsAt:
          typeof g.limited.startsAt === "string" ? g.limited.startsAt : "",
        endsAt: typeof g.limited.endsAt === "string" ? g.limited.endsAt : "",
      };
      if (enabled) {
        base.offerId = g.offerId && g.offerId.length ? g.offerId : newOfferId();
      }
    } else if (g.type !== "bundle") {
      delete base.limited;
      delete base.offerId;
    }
    // A bundle is one discount on the whole kit — drop any stale per-accessory
    // overrides (an add-on-only concept) so the cart/Function match the editor.
    if (g.type === "bundle") {
      base.accessories = base.accessories.map((a) => {
        const { discountPercent: _drop, ...rest } = a;
        return rest;
      });
    }
    return base;
  });

  // Bundle codes are customer-facing (search / deep-link / cart / order), so they
  // must be present and unique within the product before we save.
  const seenCodes = new Map<string, string>();
  for (const g of parsed.groups) {
    if (!g.code) {
      return {
        ok: false,
        error: `“${g.title || "Untitled"}” needs a code. Enter a unique code for every bundle/add-on.`,
      };
    }
    const prev = seenCodes.get(g.code);
    if (prev) {
      return {
        ok: false,
        error: `Code “${g.code}” is used by more than one group (“${prev}” and “${g.title}”). Codes must be unique.`,
      };
    }
    seenCodes.set(g.code, g.title || "Untitled");
  }

  // Keep each accessory's stored title/handle in sync with Shopify (renames,
  // handle changes) so the editor and the storefront (which fetches by handle)
  // stay correct.
  const accIds = parsed.groups.flatMap((g) =>
    g.accessories.map((a) => a.productId),
  );
  if (accIds.length) {
    const { info } = await fetchProductPrices(admin, accIds);
    parsed.groups = parsed.groups.map((g) => ({
      ...g,
      accessories: g.accessories.map((a) => {
        const m = info[a.productId];
        return m
          ? { ...a, title: m.title || a.title, handle: m.handle || a.handle }
          : a;
      }),
    }));
  }

  const result = await saveConfig(admin, session.shop, product, parsed);
  if (!result.ok) {
    return { ok: false, error: result.userErrors.join("; ") };
  }

  const reconcile = await reconcileLimitedOffers(admin, product, parsed);
  if (reconcile.userErrors.length > 0) {
    return {
      ok: false,
      error: `Saved, but limited offers had issues: ${reconcile.userErrors.join("; ")}`,
    };
  }
  return redirect("/app");
};

const LIMITED_MODE_OPTIONS = [
  { label: "Revert to normal bundle price", value: "revert" },
  { label: "End — hide the bundle (full price)", value: "end" },
];

// Free gifts are now their own feature (see Free gifts / campaigns), so the
// product editor only configures Bundles and Add-ons.
const TAB_TYPES = ["bundle", "addon"] as const;
type GroupType = (typeof TAB_TYPES)[number];

/** ISO string -> value for a <input type="datetime-local"> in the browser tz. */
function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** datetime-local value (browser tz) -> ISO-8601 UTC for storage. */
function fromLocalInput(v: string) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount || 0);
  } catch {
    return "$" + (amount || 0).toFixed(2);
  }
}

const DEFAULT_LIMITED: LimitedOffer = {
  enabled: true,
  discountPercent: 30,
  mode: "revert",
  startsAt: "",
  endsAt: "",
};

function blankGroup(type: GroupType): AddonGroup {
  const titles: Record<GroupType, string> = {
    bundle: "Bundle & Save",
    addon: "Add On & Save",
  };
  return {
    id: newGroupId(),
    code: "",
    title: titles[type],
    type,
    discountPercent: 10,
    accessories: [],
  };
}

function priceOfPicked(p: any): number | null {
  const cand =
    p?.variants?.[0]?.price ??
    p?.priceRange?.minVariantPrice?.amount ??
    p?.priceRangeV2?.minVariantPrice?.amount;
  const n = Number(cand);
  return Number.isFinite(n) ? n : null;
}

export default function ProductConfig() {
  const {
    product,
    mainImages,
    config: initial,
    prices,
    compareAt,
    variants,
    info,
    inventory,
    currency,
    offerStatus,
    offerHealError,
    giftInfo,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [groups, setGroups] = useState<AddonGroup[]>(initial.groups);
  const [tab, setTab] = useState(0);
  const [priceMap, setPriceMap] = useState<Record<string, number>>(prices);
  const compareMap = compareAt;
  const [variantMap, setVariantMap] =
    useState<Record<string, { id: string; title: string; price?: number; compareAt?: number }[]>>(variants);
  const [infoMap, setInfoMap] =
    useState<Record<string, { title: string; handle: string; image: string | null }>>(
      info,
    );
  const isSaving = fetcher.state !== "idle";

  // Report a failed save as an admin toast too (success redirects away).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Deep link from the dashboard (#groupId): switch to that group's tab, then
  // scroll + flash it.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace("#", ""));
    if (!hash) return;
    const g = groups.find((x) => x.id === hash);
    if (g && !g.archived)
      setTab(Math.max(0, (TAB_TYPES as readonly string[]).indexOf(g.type)));
    const t = setTimeout(() => {
      const node = document.getElementById(hash);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.style.transition = "box-shadow .3s";
      node.style.borderRadius = "10px";
      node.style.boxShadow = "0 0 0 3px #3659a7";
      setTimeout(() => (node.style.boxShadow = ""), 1600);
    }, 80);
    return () => clearTimeout(t);
  }, []);
  const addGroup = useCallback((type: GroupType) => {
    setGroups((prev) => [...prev, blankGroup(type)]);
  }, []);

  const updateGroup = useCallback((id: string, patch: Partial<AddonGroup>) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, []);

  const updateAccessory = useCallback(
    (groupId: string, productId: string, patch: Partial<AddonAccessory>) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                accessories: g.accessories.map((a) =>
                  a.productId === productId ? { ...a, ...patch } : a,
                ),
              }
            : g,
        ),
      );
    },
    [],
  );

  // Deleting a group ARCHIVES it (soft delete) so it can be restored/reused.
  const archiveGroup = useCallback((id: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, archived: true } : g)),
    );
  }, []);
  const restoreGroup = useCallback((id: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, archived: false } : g)),
    );
  }, []);
  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  // Drag-to-reorder groups within the current tab (same type only).
  const dragGroupId = useRef<string | null>(null);
  const moveGroup = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setGroups((prev) => {
      const fromGroup = prev.find((g) => g.id === fromId);
      if (!fromGroup) return prev;
      const type = fromGroup.type;
      const ids = prev
        .filter((g) => !g.archived && g.type === type)
        .map((g) => g.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);
      const byId = new Map(prev.map((g) => [g.id, g]));
      let i = 0;
      // Refill the slots that belong to this tab's type in the new order.
      return prev.map((g) =>
        !g.archived && g.type === type ? (byId.get(ids[i++]) as AddonGroup) : g,
      );
    });
  }, []);

  const pickAccessories = useCallback(
    async (groupId: string, existing: AddonAccessory[]) => {
      const picked = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: true,
        selectionIds: existing.map((a) => ({ id: a.productId })),
      });
      if (!picked) return;
      const prevById = new Map(existing.map((a) => [a.productId, a]));
      const captured: Record<string, number> = {};
      const capturedVars: Record<string, { id: string; title: string; price?: number; compareAt?: number }[]> = {};
      const capturedInfo: Record<
        string,
        { title: string; handle: string; image: string | null }
      > = {};
      const accessories: AddonAccessory[] = picked
        .filter((p: any) => p.id !== product.id)
        .map((p: any) => {
          const price = priceOfPicked(p);
          if (price != null) captured[p.id] = price;
          capturedInfo[p.id] = {
            title: p.title || "",
            handle: p.handle || "",
            image:
              p.images?.[0]?.originalSrc ??
              p.images?.[0]?.src ??
              p.featuredImage?.url ??
              null,
          };
          if (Array.isArray(p.variants) && p.variants.length) {
            capturedVars[p.id] = p.variants
              .filter((v: any) => v?.id)
              .map((v: any) => ({ id: v.id, title: v.title || "" }));
          }
          const prior = prevById.get(p.id);
          const acc: AddonAccessory = {
            productId: p.id,
            handle: p.handle,
            title: p.title,
          };
          if (prior?.discountPercent != null)
            acc.discountPercent = prior.discountPercent;
          if (prior?.variantIds) acc.variantIds = prior.variantIds;
          return acc;
        });
      if (Object.keys(captured).length) {
        setPriceMap((prev) => ({ ...prev, ...captured }));
      }
      if (Object.keys(capturedVars).length) {
        setVariantMap((prev) => ({ ...prev, ...capturedVars }));
      }
      setInfoMap((prev) => ({ ...prev, ...capturedInfo }));
      updateGroup(groupId, { accessories });
    },
    [shopify, product.id, updateGroup],
  );

  const removeAccessory = useCallback((groupId: string, productId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              accessories: g.accessories.filter((a) => a.productId !== productId),
            }
          : g,
      ),
    );
  }, []);

  const save = useCallback(() => {
    const payload: AddonConfig = { version: 1, groups };
    fetcher.submit({ config: JSON.stringify(payload) }, { method: "POST" });
  }, [groups, fetcher]);

  const numericId = product.id.replace("gid://shopify/Product/", "");
  const activeGroups = groups.filter((g) => !g.archived);
  // Free is now its own feature (Free gifts); don't surface legacy free groups
  // (active or archived) in the product editor.
  const archivedGroups = groups.filter((g) => g.archived && g.type !== "free");
  const countOf = (t: GroupType) =>
    activeGroups.filter((g) => g.type === t).length;
  const currentType = TAB_TYPES[tab];
  const tabGroups = activeGroups.filter((g) => g.type === currentType);
  const mainPrice = priceMap[product.id] ?? null;

  // Codes must be present and unique across the whole product (they drive search,
  // deep-links and cart/order labels). Count across ALL groups so a collision is
  // flagged even when the twin lives on the other tab.
  const codeCounts = groups.reduce<Record<string, number>>((acc, g) => {
    if (g.code) acc[g.code] = (acc[g.code] ?? 0) + 1;
    return acc;
  }, {});
  const codeErrorFor = (g: AddonGroup): string | undefined => {
    if (!g.code) return "Enter a code.";
    if (codeCounts[g.code] > 1) return "Another group already uses this code.";
    return undefined;
  };

  // A saved limited offer whose backing discount node is missing would silently
  // charge the base price. The loader self-heals on open; if it still couldn't
  // create the node (e.g. Function not deployed), surface a warning on the card.
  const offerWarningFor = (g: AddonGroup): string | undefined => {
    if (!(g.type === "bundle" && g.limited?.enabled && g.offerId)) return undefined;
    const st = offerStatus[g.offerId];
    if (st && !st.hasNode) {
      return offerHealError
        ? `This limited offer’s discount isn’t active: ${offerHealError}`
        : "This limited offer’s discount isn’t active yet — click Save to activate it.";
    }
    return undefined;
  };

  const TAB_LABELS = [
    `Bundle (${countOf("bundle")})`,
    `Add-on (${countOf("addon")})`,
  ];
  const addLabel = currentType === "bundle" ? "Add bundle" : "Add add-on";
  const hasCodeError = groups.some((g) => Boolean(codeErrorFor(g)));

  return (
    <OffersShell>
      <PageHead
        back={{ to: "/app/products", label: "Products" }}
        title={
          <span className="kb-inline" style={{ gap: 10 }}>
            {product.title}
            <Pill tone="info">{`${activeGroups.length} group(s)`}</Pill>
          </span>
        }
        actions={
          <>
            <a
              className="kb-btn"
              href={`shopify:admin/products/${numericId}`}
              target="_blank"
              rel="noreferrer"
            >
              View product
            </a>
            <Btn
              variant="primary"
              loading={isSaving}
              disabled={hasCodeError}
              onClick={save}
            >
              Save
            </Btn>
          </>
        }
      />

      {fetcher.data?.error ? (
        <Banner tone="danger">
          <b>Could not save.</b> {fetcher.data.error}
        </Banner>
      ) : null}

      <div className="kb-grid-2">
        <div className="kb-stack">
          {/* Main product shown ONCE — every bundle/add-on on this page
              attaches to it, so no need to repeat it per card. */}
          <div className="kb-group">
            <div className="kb-between">
              <div className="kb-ident">
                <Thumb
                  src={infoMap[product.id]?.image ?? product.image}
                  size={44}
                  alt=""
                />
                <div style={{ minWidth: 0 }}>
                  <div className="kb-inline" style={{ gap: 6 }}>
                    <span className="kb-title">{product.title}</span>
                    <Pill tone="info">Main product</Pill>
                  </div>
                  {mainPrice != null ? (
                    <div className="kb-sub">{fmtMoney(mainPrice, currency)}</div>
                  ) : null}
                </div>
              </div>
              <StockBadge qty={inventory[product.id] ?? null} />
            </div>
          </div>

          <div>
            <Segmented
              value={String(tab)}
              onChange={(v) => setTab(Number(v))}
              options={TAB_LABELS.map((label, i) => ({ value: String(i), label }))}
            />
          </div>

          {tabGroups.length === 0 ? (
            <div className="kb-group">
              <Empty
                title={`No ${currentType}s yet`}
                action={
                  <Btn variant="primary" onClick={() => addGroup(currentType)}>
                    <IconPlus size={14} />
                    {addLabel}
                  </Btn>
                }
              />
            </div>
          ) : (
            tabGroups.map((group) => (
              <div
                key={group.id}
                id={group.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragGroupId.current)
                    moveGroup(dragGroupId.current, group.id);
                  dragGroupId.current = null;
                }}
              >
                <GroupCard
                  group={group}
                  productHandle={product.handle}
                  codeError={codeErrorFor(group)}
                  offerWarning={offerWarningFor(group)}
                  prices={priceMap}
                  compareAt={compareMap}
                  variants={variantMap}
                  info={infoMap}
                  inventory={inventory}
                  mainVariants={variantMap[product.id] || []}
                  mainImages={mainImages}
                  mainTitle={product.title}
                  mainPrice={mainPrice}
                  mainCompareAt={compareMap[product.id] ?? mainPrice}
                  currency={currency}
                  dragHandle={
                    <span
                      className="kb-drag"
                      draggable
                      onDragStart={(e) => {
                        dragGroupId.current = group.id;
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        dragGroupId.current = null;
                      }}
                      aria-label="Drag to reorder"
                      title="Drag to reorder"
                    >
                      <IconDrag />
                    </span>
                  }
                  onChange={(patch) => updateGroup(group.id, patch)}
                  onArchive={() => archiveGroup(group.id)}
                  onPickAccessories={() =>
                    pickAccessories(group.id, group.accessories)
                  }
                  onRemoveAccessory={(pid) => removeAccessory(group.id, pid)}
                  onUpdateAccessory={(pid, patch) =>
                    updateAccessory(group.id, pid, patch)
                  }
                />
              </div>
            ))
          )}

          {tabGroups.length > 0 ? (
            <div>
              <Btn onClick={() => addGroup(currentType)}>
                <IconPlus size={14} />
                {addLabel}
              </Btn>
            </div>
          ) : null}

          {archivedGroups.length > 0 ? (
            <ArchivedSection
              groups={archivedGroups}
              onRestore={restoreGroup}
              onDelete={deleteGroup}
            />
          ) : null}
        </div>

        <aside className="kb-side kb-sticky">
          <GiftInfoCard gifts={giftInfo} />
          <Panel title="How it works">
            <p>
              <b>Bundle</b> — a curated set sold together. One discount applies to
              the whole kit (main + accessories). Toggle <b>Limited-time offer</b>{" "}
              for a countdown + deeper price.
            </p>
            <p>
              <b>Add-on</b> — individual extras. <b>Free add-on</b> rides along at
              100% off.
            </p>
            <div className="kb-divider" />
            <p>
              Each accessory can override the group discount — leave its box blank
              to use the group %. Give each bundle a unique <b>code</b> — it&apos;s
              searchable and shows on the cart &amp; order.
            </p>
          </Panel>
        </aside>
      </div>
    </OffersShell>
  );
}

const GIFT_STATE_PILL: Record<
  ProductGiftInfo["state"],
  { label: string; tone: "ok" | "warn" | "info" | undefined }
> = {
  active: { label: "Active", tone: "ok" },
  scheduled: { label: "Scheduled", tone: "warn" },
  ended: { label: "Ended", tone: undefined },
  paused: { label: "Paused", tone: undefined },
  draft: { label: "Draft", tone: undefined },
};

/** ④ Read-only card: which gift campaigns give a free gift with this product. */
function GiftInfoCard({ gifts }: { gifts: ProductGiftInfo[] }) {
  return (
    <Panel
      title="Free gifts"
      actions={
        <Link to="/app/gifts" prefetch="intent" className="kb-btn kb-btn--link kb-small">
          Manage
        </Link>
      }
    >
      {gifts.length === 0 ? (
        <p>
          No gift campaign includes this product yet. Buyers get a free gift when
          a campaign&apos;s trigger product is purchased — set one up under{" "}
          <b>Free gifts</b>.
        </p>
      ) : (
        <div className="kb-stack kb-stack--tight">
          <p>Buying this product triggers these free-gift campaigns:</p>
          {gifts.map((g) => {
            const pill = GIFT_STATE_PILL[g.state];
            return (
              <div key={g.id} className="kb-box">
                <div className="kb-between" style={{ marginBottom: 6 }}>
                  <Link
                    to={`/app/gifts/${g.id}`}
                    prefetch="intent"
                    className="kb-title"
                    style={{ fontSize: 13 }}
                  >
                    {g.title}
                  </Link>
                  <Pill tone={pill.tone}>{pill.label}</Pill>
                </div>
                <div>
                  {g.gifts.map((gp, i) => (
                    <span key={i} className="kb-refchip kb-refchip--gift">
                      <Thumb src={gp.image} size={22} alt="" />
                      <span>{gp.title}</span>
                    </span>
                  ))}
                </div>
                {g.perQualifying > 1 ? (
                  <div className="kb-sub">{`${g.perQualifying} free per qualifying item`}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/** Inventory pill: green in-stock, amber low, red sold-out; nothing if untracked. */
function StockBadge({ qty }: { qty: number | null | undefined }) {
  if (qty == null) return null; // not tracked / unknown
  if (qty <= 0) return <Pill tone="danger">Sold out</Pill>;
  if (qty <= 5) return <Pill tone="warn">{`${qty} left`}</Pill>;
  return <Pill tone="ok">{`${qty} in stock`}</Pill>;
}

/** A small "?" that reveals a short explanation on click — keeps cards uncluttered. */
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span className="kb-tip" ref={ref}>
      <button
        type="button"
        className="kb-iconbtn kb-iconbtn--sm"
        aria-label="What's this?"
        onClick={() => setOpen((o) => !o)}
      >
        <IconHelp size={14} />
      </button>
      {open ? (
        <span className="kb-tip__pop" role="tooltip">
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** A labelled field with an inline "?" tip (div, not <label>, so the tip button
 *  doesn't steal label clicks). */
function LField({
  text,
  tip,
  required,
  error,
  help,
  children,
}: {
  text: string;
  tip?: string;
  required?: boolean;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="kb-lfield">
      <span className="kb-lfield__label">
        {text}
        {required ? " *" : ""}
        {tip ? <InfoTip text={tip} /> : null}
      </span>
      {children}
      {error ? <span className="kb-field__error">{error}</span> : null}
      {help ? <span className="kb-field__help">{help}</span> : null}
    </div>
  );
}

/** Variant toggle chips; keeps at least one selected, all = undefined. */
function VariantChips({
  all,
  selected,
  onChange,
}: {
  all: { id: string; title: string }[];
  selected: string[] | undefined;
  onChange: (ids: string[] | undefined) => void;
}) {
  const current = selected && selected.length ? selected : all.map((x) => x.id);
  return (
    <div className="kb-chips">
      {all.map((v) => {
        const on = current.includes(v.id);
        return (
          <button
            key={v.id}
            type="button"
            className={`kb-chip${on ? " is-on" : ""}`}
            onClick={() => {
              const next = on
                ? current.filter((x) => x !== v.id)
                : [...current, v.id];
              if (next.length === 0) return; // keep at least one offered
              onChange(next.length === all.length ? undefined : next);
            }}
          >
            {v.title}
          </button>
        );
      })}
    </div>
  );
}

const GROUP_TONE = (isFree: boolean, limitedOn: boolean, isBundle: boolean) =>
  isFree ? "ok" : limitedOn ? "warn" : isBundle ? "info" : undefined;

function GroupCard({
  group,
  productHandle,
  codeError,
  offerWarning,
  prices,
  compareAt,
  variants,
  info,
  inventory,
  mainVariants,
  mainImages,
  mainTitle,
  mainPrice,
  mainCompareAt,
  currency,
  dragHandle,
  onChange,
  onArchive,
  onPickAccessories,
  onRemoveAccessory,
  onUpdateAccessory,
}: {
  group: AddonGroup;
  productHandle: string;
  codeError?: string;
  offerWarning?: string;
  prices: Record<string, number>;
  compareAt: Record<string, number>;
  variants: Record<string, { id: string; title: string; price?: number; compareAt?: number }[]>;
  info: Record<string, { title: string; handle: string; image: string | null }>;
  inventory: Record<string, number | null>;
  mainVariants: { id: string; title: string; price?: number; compareAt?: number }[];
  mainImages?: { url: string; alt: string }[];
  mainTitle?: string;
  mainPrice: number | null;
  mainCompareAt: number | null;
  currency: string;
  dragHandle: ReactNode;
  onChange: (patch: Partial<AddonGroup>) => void;
  onArchive: () => void;
  onPickAccessories: () => void;
  onRemoveAccessory: (productId: string) => void;
  onUpdateAccessory: (productId: string, patch: Partial<AddonAccessory>) => void;
}) {
  // Drag-to-reorder accessories within this group.
  const dragAccId = useRef<string | null>(null);
  const moveAccessory = (fromPid: string, toPid: string) => {
    if (fromPid === toPid) return;
    const arr = group.accessories.slice();
    const fromIdx = arr.findIndex((a) => a.productId === fromPid);
    const toIdx = arr.findIndex((a) => a.productId === toPid);
    if (fromIdx < 0 || toIdx < 0) return;
    const [m] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, m);
    onChange({ accessories: arr });
  };

  // Collapsed-by-default card; expand into tabs. Progressive disclosure inside.
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState(0);
  const [coverOpen, setCoverOpen] = useState(false);
  const [mainVarsOpen, setMainVarsOpen] = useState(false);
  const [openVarPids, setOpenVarPids] = useState<Record<string, boolean>>({});
  const toggleVarOpen = (pid: string) =>
    setOpenVarPids((m) => ({ ...m, [pid]: !m[pid] }));

  const isFree = group.type === "free";
  const isBundle = group.type === "bundle";
  const limitedOn = isBundle && Boolean(group.limited?.enabled);

  // Quick-pick cover images = the MAIN product's full gallery (demo / kit shots
  // usually live there), newest-uploaded order as Shopify returns them.
  const coverChoices: { url: string; label: string }[] = isBundle
    ? (mainImages || []).map((im, i) => ({
        url: im.url,
        label: im.alt || `${mainTitle || "Image"} ${i + 1}`,
      }))
    : [];

  // Bundle = ONE discount on the whole kit. Each line carries its TRUE original
  // (compare-at, `orig`) and its current Shopify selling price (`now`). The
  // representative is the FIRST variant actually OFFERED to the customer (so a
  // cheaper, non-offered variant doesn't skew the estimate) — matching what the
  // storefront defaults to. Falls back to the product-level price if needed.
  const repFromOffered = (
    vs: { id: string; title: string; price?: number; compareAt?: number }[],
    offeredIds: string[] | undefined,
    fallbackNow: number,
    fallbackOrig: number,
  ): { now: number; orig: number } => {
    const offered =
      offeredIds && offeredIds.length
        ? vs.filter((v) => offeredIds.includes(v.id))
        : vs;
    const v = offered[0] || vs[0];
    if (v && typeof v.price === "number") {
      return { now: v.price, orig: v.compareAt ?? v.price };
    }
    return { now: fallbackNow, orig: fallbackOrig };
  };
  const haveAllPrices = group.accessories.every(
    (a) => prices[a.productId] != null,
  );
  const mainRep = repFromOffered(
    mainVariants,
    group.mainVariantIds,
    mainPrice ?? 0,
    mainCompareAt ?? mainPrice ?? 0,
  );
  const bundleLines: { label: string; orig: number; now: number }[] = [
    ...(mainPrice != null
      ? [{ label: "Main product", orig: mainRep.orig, now: mainRep.now }]
      : []),
    ...group.accessories.map((a) => {
      const fb = prices[a.productId] ?? 0;
      const rep = repFromOffered(
        variants[a.productId] || [],
        a.variantIds,
        fb,
        compareAt[a.productId] ?? fb,
      );
      return {
        label: info[a.productId]?.title || a.title || a.handle,
        orig: rep.orig,
        now: rep.now,
      };
    }),
  ];
  const bundleTotalNow = bundleLines.reduce((s, l) => s + l.now, 0);

  // ---- Collapsed summary values ----
  const bundlePct = clampPercent(group.discountPercent);
  const summaryNow = bundleTotalNow * (1 - bundlePct / 100);
  const summaryOrig = bundleLines.reduce((s, l) => s + l.orig, 0);
  const summaryOffPct =
    summaryOrig > summaryNow + 0.005
      ? Math.round(((summaryOrig - summaryNow) / summaryOrig) * 100)
      : 0;
  const summaryThumbs: string[] = [];
  if (isBundle) {
    const mt = group.coverImage || (mainImages && mainImages[0]?.url);
    if (mt) summaryThumbs.push(mt);
  }
  group.accessories.forEach((a) => {
    const im = info[a.productId]?.image;
    if (im) summaryThumbs.push(im);
  });
  const invVals = group.accessories
    .map((a) => inventory[a.productId])
    .filter((v): v is number => v != null);
  const minStock = invVals.length ? Math.min(...invVals) : null;
  const tabItems = isBundle
    ? [
        { id: `t-info-${group.id}`, content: "Info" },
        { id: `t-prod-${group.id}`, content: "Products" },
        { id: `t-price-${group.id}`, content: "Price" },
        { id: `t-lim-${group.id}`, content: "Limited" },
      ]
    : [
        { id: `t-info-${group.id}`, content: "Info" },
        { id: `t-prod-${group.id}`, content: "Products" },
      ];

  const mainVarCount = group.mainVariantIds?.length ?? mainVariants.length;

  return (
    <div className="kb-group">
      {/* ---- Summary (always visible): row 1 = info, row 2 = thumbs + price ---- */}
      <div className="kb-group__head">
        {dragHandle}
        <Pill tone={GROUP_TONE(isFree, limitedOn, isBundle)}>{formLabel(group)}</Pill>
        {group.hidden ? <Pill tone="warn">Hidden</Pill> : null}
        <button
          type="button"
          className="kb-group__name"
          onClick={() => setExpanded((v) => !v)}
        >
          {group.code ? <span className="kb-sub">{group.code}</span> : null}
          <b>{group.title || "Untitled"}</b>
        </button>
        <IconBtn
          label={group.hidden ? "Show on storefront" : "Hide from storefront"}
          onClick={() => onChange({ hidden: !group.hidden })}
        >
          {group.hidden ? <IconEyeOff /> : <IconEye />}
        </IconBtn>
        <IconBtn
          label={expanded ? "Collapse" : "Expand"}
          onClick={() => setExpanded((v) => !v)}
        >
          <IconChevron up={expanded} />
        </IconBtn>
        <IconBtn label="Archive group" onClick={onArchive}>
          <IconArchive />
        </IconBtn>
      </div>

      {summaryThumbs.length > 0 || (isBundle && haveAllPrices) || !isFree ? (
        <div className="kb-group__sum">
          <div className="kb-thumbs">
            {summaryThumbs.slice(0, 6).map((u, i) => (
              <Thumb key={i} src={u} size={28} alt="" />
            ))}
            {summaryThumbs.length > 6 ? (
              <span className="kb-sub">+{summaryThumbs.length - 6}</span>
            ) : null}
          </div>
          <div className="kb-inline" style={{ flexWrap: "nowrap" }}>
            {isBundle && haveAllPrices ? (
              <>
                <b>{fmtMoney(summaryNow, currency)}</b>
                {summaryOffPct > 0 ? (
                  <Pill tone="danger">{`${summaryOffPct}% off`}</Pill>
                ) : null}
              </>
            ) : null}
            {!isFree ? <StockBadge qty={minStock} /> : null}
          </div>
        </div>
      ) : null}

      {offerWarning ? (
        <div style={{ marginTop: 10 }}>
          <Banner tone="danger">
            <b>Limited offer not active.</b> {offerWarning}
          </Banner>
        </div>
      ) : null}
      {codeError && !expanded ? (
        <div className="kb-field__error" style={{ marginTop: 6 }}>
          {codeError}
        </div>
      ) : null}

      {expanded ? (
        <div className="kb-group__body">
          <div>
            <Segmented
              value={String(tab)}
              onChange={(v) => setTab(Number(v))}
              options={tabItems.map((t, i) => ({ value: String(i), label: t.content }))}
            />
          </div>

          {/* ---- INFO TAB ---- */}
          {tab === 0 ? (
            <>
              {/* Code + title (+ discount for add-ons) on one tidy row. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isBundle ? "38fr 62fr" : "30fr 42fr 28fr",
                  gap: 12,
                  alignItems: "start",
                }}
              >
                <LField
                  text="Code"
                  required
                  error={codeError}
                  tip="Customer-facing code — searchable, shown on the storefront card, and on the cart line & order via the discount. A–Z, 0–9 and dashes."
                >
                  <Input
                    autoComplete="off"
                    className={codeError ? "is-error" : undefined}
                    value={group.code}
                    onChange={(e) => onChange({ code: normalizeCode(e.target.value) })}
                    placeholder="e.g. CREATOR-KIT"
                  />
                </LField>
                <LField
                  text={isFree ? "Section title" : "Card / tab title"}
                  tip={
                    isFree
                      ? "Heading for the gift section, e.g. “🎁 Free gift”."
                      : isBundle
                        ? "Shown as the bundle card name, e.g. “Advanced Kit”."
                        : "Shown as the tab label, e.g. “T-Series Lenses”."
                  }
                >
                  <Input
                    autoComplete="off"
                    value={group.title}
                    onChange={(e) => onChange({ title: e.target.value })}
                  />
                </LField>
                {!isBundle ? (
                  <LField
                    text="Discount %"
                    tip={
                      isFree
                        ? "Free add-ons are always 100% off."
                        : "Default % for accessories that don't set their own."
                    }
                  >
                    <AffixInput
                      suffix="%"
                      type="number"
                      min={0}
                      max={100}
                      autoComplete="off"
                      disabled={isFree}
                      value={String(isFree ? 100 : group.discountPercent)}
                      onChange={(e) =>
                        onChange({ discountPercent: clampPercent(e.target.value) })
                      }
                    />
                  </LField>
                ) : null}
              </div>

              {/* Bundle cover image (bundle only): single thumbnail + click-to-open picker. */}
              {isBundle ? (
                <LField
                  text="Bundle cover image"
                  tip="Shown as the bundle's image in search and (collapsed) on the product page. Pick one of the main product's images — the kit / installation “demo” shots you upload to the main product are ideal. Leave empty to fall back to the product's main image."
                >
                  <div className="kb-inline" style={{ gap: 12 }}>
                    <Thumb src={group.coverImage} size={72} alt="Bundle cover" />
                    <Btn
                      disabled={coverChoices.length === 0}
                      onClick={() => setCoverOpen((o) => !o)}
                    >
                      {group.coverImage ? "Change cover" : "Choose cover"}
                      <IconChevron size={14} up={coverOpen} />
                    </Btn>
                    {group.coverImage ? (
                      <button
                        type="button"
                        className="kb-btn kb-btn--link"
                        style={{ color: "var(--danger)" }}
                        onClick={() => onChange({ coverImage: undefined })}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {coverOpen ? (
                    coverChoices.length > 0 ? (
                      <div className="kb-inline" style={{ gap: 6, marginTop: 6 }}>
                        {coverChoices.map((c) => (
                          <button
                            key={c.url}
                            type="button"
                            title={c.label}
                            className={`kb-cover${group.coverImage === c.url ? " is-on" : ""}`}
                            onClick={() => {
                              onChange({ coverImage: c.url });
                              setCoverOpen(false);
                            }}
                          >
                            <img src={sized(c.url, 48)} alt={c.label} loading="lazy" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="kb-sub">
                        This product has no images to pick from — add images to the
                        main product first.
                      </span>
                    )
                  ) : null}
                </LField>
              ) : null}

              {/* Deep-link (bundle only): just the link + a "?" for how to use it. */}
              {isBundle ? (
                <LField
                  text="Search deep-link"
                  tip="Link customers straight to this bundle (auto-selected). Your search engine can read every bundle from this product's custom.addon_config metafield and link to it with this code."
                >
                  <Input
                    readOnly
                    autoComplete="off"
                    value={`/products/${productHandle}?kb_bundle=${group.code}`}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </LField>
              ) : null}

              {/* Add-on visibility targeting — bundles put their main variants in the
                  Products tab instead. */}
              {!isFree && !isBundle && mainVariants.length > 1 ? (
                <div className="kb-box">
                  <div className="kb-sub" style={{ marginBottom: 8 }}>
                    {`Show this add-on for main variants (${mainVarCount}/${mainVariants.length})`}
                  </div>
                  <VariantChips
                    all={mainVariants}
                    selected={group.mainVariantIds}
                    onChange={(ids) => onChange({ mainVariantIds: ids })}
                  />
                  <div className="kb-sub" style={{ marginTop: 8 }}>
                    This add-on group only shows when the selected main variant is
                    one of these — otherwise it&apos;s hidden.
                  </div>
                </div>
              ) : null}

              {!isFree ? (
                <div className="kb-inline" style={{ gap: 4 }}>
                  <Checkbox
                    label="Hide when sold out"
                    checked={!!group.hideWhenSoldOut}
                    onChange={(v) => onChange({ hideWhenSoldOut: v })}
                  />
                  <InfoTip
                    text={
                      isBundle
                        ? "Off by default. When on, the whole bundle disappears from the storefront if any item in it is out of stock (the kit can't be completed)."
                        : "Off by default. When on, an item with no stock disappears from the storefront; when every item is sold out the whole group hides."
                    }
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {/* ---- PRODUCTS TAB ---- */}
          {tab === 1 ? (
            <>
              {isBundle && mainTitle ? (
                <div>
                  <div className="kb-overline" style={{ marginBottom: 8 }}>
                    In this kit
                  </div>
                  <div className="kb-between">
                    <div className="kb-ident">
                      <Thumb
                        src={group.coverImage || (mainImages && mainImages[0]?.url)}
                        size={44}
                        alt=""
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="kb-inline" style={{ gap: 6 }}>
                          <span>{mainTitle}</span>
                          <Pill>MAIN</Pill>
                        </div>
                        {mainPrice != null ? (
                          <div className="kb-sub">{fmtMoney(mainRep.now, currency)}</div>
                        ) : null}
                      </div>
                    </div>
                    {mainVariants.length > 1 ? (
                      <Btn size="tiny" onClick={() => setMainVarsOpen((o) => !o)}>
                        {`Variants ${mainVarCount}/${mainVariants.length}`}
                        <IconChevron size={14} up={mainVarsOpen} />
                      </Btn>
                    ) : null}
                  </div>
                  {mainVariants.length > 1 && mainVarsOpen ? (
                    <div className="kb-indent" style={{ marginTop: 8, paddingLeft: 56 }}>
                      <VariantChips
                        all={mainVariants}
                        selected={group.mainVariantIds}
                        onChange={(ids) => onChange({ mainVariantIds: ids })}
                      />
                      <div className="kb-sub" style={{ marginTop: 6 }}>
                        Offered as the main-product options inside the bundle — the
                        customer picks one.
                      </div>
                    </div>
                  ) : null}
                  <div className="kb-divider" style={{ marginBottom: 0 }} />
                </div>
              ) : null}

              <div className="kb-between">
                <b>{`Accessories (${group.accessories.length})`}</b>
                <Btn onClick={onPickAccessories}>Select accessories</Btn>
              </div>

              {group.accessories.length > 0 ? (
                <div className="kb-stack kb-stack--tight">
                  {group.accessories.map((a) => {
                    const accVariants = variants[a.productId] || [];
                    const offeredIds =
                      a.variantIds && a.variantIds.length
                        ? a.variantIds
                        : accVariants.map((v) => v.id);
                    // Show the FIRST offered variant's price (what the storefront
                    // defaults to), not the cheapest non-offered one.
                    const repV =
                      accVariants.find((v) => offeredIds.includes(v.id)) ||
                      accVariants[0];
                    const price =
                      typeof repV?.price === "number"
                        ? repV.price
                        : prices[a.productId];
                    const pct = effectiveAccessoryPercent(group, a);
                    return (
                      <div
                        key={a.productId}
                        className="kb-stack kb-stack--tight"
                        style={{ gap: 8 }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragAccId.current)
                            moveAccessory(dragAccId.current, a.productId);
                          dragAccId.current = null;
                        }}
                      >
                        <div className="kb-acc">
                          <span
                            className="kb-drag"
                            draggable
                            onDragStart={(e) => {
                              dragAccId.current = a.productId;
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              dragAccId.current = null;
                            }}
                            title="Drag to reorder"
                          >
                            <IconDrag />
                          </span>
                          <Thumb src={info[a.productId]?.image} size={44} alt="" />
                          <div style={{ minWidth: 0 }}>
                            <div className="kb-inline" style={{ gap: 6 }}>
                              <span>{info[a.productId]?.title || a.title || a.handle}</span>
                              <StockBadge qty={inventory[a.productId]} />
                            </div>
                            {price != null ? (
                              <div className="kb-sub">{fmtMoney(price, currency)}</div>
                            ) : null}
                          </div>
                          <div className="kb-inline" style={{ flexWrap: "nowrap", gap: 4 }}>
                            {accVariants.length > 1 ? (
                              <Btn size="tiny" onClick={() => toggleVarOpen(a.productId)}>
                                {`Variants ${offeredIds.length}/${accVariants.length}`}
                                <IconChevron size={14} up={!!openVarPids[a.productId]} />
                              </Btn>
                            ) : null}
                            <IconBtn
                              label={`Remove ${a.title}`}
                              tone="danger"
                              onClick={() => onRemoveAccessory(a.productId)}
                            >
                              <IconTrash />
                            </IconBtn>
                          </div>
                        </div>

                        {isFree ? (
                          <div className="kb-sub" style={{ textAlign: "right" }}>
                            FREE
                          </div>
                        ) : isBundle ? null : price != null ? (
                          <div className="kb-indent kb-between" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                            <DiscountCalc
                              price={price}
                              percent={pct}
                              onChangePercent={(p) =>
                                onUpdateAccessory(a.productId, {
                                  discountPercent: p,
                                })
                              }
                            />
                            {a.discountPercent != null ? (
                              <Btn
                                variant="link"
                                onClick={() =>
                                  onUpdateAccessory(a.productId, {
                                    discountPercent: undefined,
                                  })
                                }
                              >
                                {`Reset to group ${pctStr(group.discountPercent)}%`}
                              </Btn>
                            ) : null}
                          </div>
                        ) : (
                          <div className="kb-indent">
                            <div style={{ width: 120 }}>
                              <LField text="Discount %">
                                <AffixInput
                                  suffix="%"
                                  type="number"
                                  min={0}
                                  max={100}
                                  autoComplete="off"
                                  placeholder={String(group.discountPercent)}
                                  value={
                                    a.discountPercent == null
                                      ? ""
                                      : String(a.discountPercent)
                                  }
                                  onChange={(e) =>
                                    onUpdateAccessory(a.productId, {
                                      discountPercent:
                                        e.target.value === ""
                                          ? undefined
                                          : clampPercent(e.target.value),
                                    })
                                  }
                                />
                              </LField>
                            </div>
                          </div>
                        )}

                        {accVariants.length > 1 && openVarPids[a.productId] ? (
                          <div className="kb-indent">
                            <div className="kb-sub" style={{ marginBottom: 6 }}>
                              {`Variants offered to the customer (${offeredIds.length}/${accVariants.length})`}
                            </div>
                            <VariantChips
                              all={accVariants}
                              selected={a.variantIds}
                              onChange={(ids) =>
                                onUpdateAccessory(a.productId, { variantIds: ids })
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="kb-muted" style={{ margin: 0 }}>
                  No accessories in this group yet.
                </p>
              )}
            </>
          ) : null}

          {/* ---- PRICE TAB (bundle) ---- */}
          {isBundle && tab === 2 ? (
            group.accessories.length > 0 && haveAllPrices ? (
              <BundleTotals
                group={group}
                lines={bundleLines}
                currency={currency}
                onChange={onChange}
              />
            ) : (
              <p className="kb-muted" style={{ margin: 0 }}>
                Add accessories with prices to set the bundle total.
              </p>
            )
          ) : null}

          {/* ---- LIMITED TAB (bundle) ---- */}
          {isBundle && tab === 3 ? (
            <LimitedOfferCard
              group={group}
              totalNow={bundleTotalNow}
              haveTotal={haveAllPrices}
              currency={currency}
              onChange={onChange}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Limited-time offer — a DEEPER whole-kit discount that runs on a timer. Same
 * three-way calculator as the normal bundle price (on the current total), plus
 * the mode + start/end window. Server-enforced via the time-gated discount node.
 */
function LimitedOfferCard({
  group,
  totalNow,
  haveTotal,
  currency,
  onChange,
}: {
  group: AddonGroup;
  totalNow: number;
  haveTotal: boolean;
  currency: string;
  onChange: (patch: Partial<AddonGroup>) => void;
}) {
  const limited = group.limited;
  const limitedOn = Boolean(limited?.enabled);
  const ended =
    limitedOn && !!limited?.endsAt && Date.parse(limited.endsAt) < Date.now();
  const patchLimited = (patch: Partial<LimitedOffer>) =>
    onChange({
      limited: { ...(limited ?? DEFAULT_LIMITED), ...patch },
      offerId: group.offerId || newOfferId(),
    });
  const deepPct = clampPercent(limited?.discountPercent ?? 0);
  return (
    <div className="kb-box kb-stack">
      <div className="kb-between">
        <Checkbox
          label="Limited-time offer (countdown + deeper price)"
          checked={limitedOn}
          onChange={(checked) =>
            onChange(
              checked
                ? {
                    limited: { ...(limited ?? DEFAULT_LIMITED), enabled: true },
                    offerId: group.offerId || newOfferId(),
                  }
                : {
                    limited: limited
                      ? { ...limited, enabled: false }
                      : { ...DEFAULT_LIMITED, enabled: false },
                  },
            )
          }
        />
        {limitedOn ? (
          ended ? <Pill tone="danger">Ended</Pill> : <Pill tone="ok">Active</Pill>
        ) : null}
      </div>

      {limitedOn ? (
        <>
          {ended ? (
            <Banner tone="warn">
              <p style={{ margin: "0 0 8px" }}>
                This promotion has ended — the bundle is now at its
                {limited?.mode === "end"
                  ? " normal full price (hidden on the storefront)."
                  : " normal price."}{" "}
                Set a new end date below to start a fresh promotion.
              </p>
              <Btn
                size="tiny"
                onClick={() => patchLimited({ startsAt: "", endsAt: "" })}
              >
                Start a new promotion
              </Btn>
            </Banner>
          ) : null}
          <div>
            <b style={{ display: "block", marginBottom: 8 }}>
              Deal price — deeper bundle discount while the timer runs
            </b>
            {haveTotal ? (
              <DiscountCalc
                price={totalNow}
                percent={deepPct}
                onChangePercent={(p) =>
                  patchLimited({ discountPercent: clampPercent(p) })
                }
              />
            ) : (
              <div style={{ width: 110 }}>
                <LField text="Deal discount">
                  <AffixInput
                    suffix="%"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={ended}
                    value={pctStr(deepPct)}
                    onChange={(e) =>
                      patchLimited({ discountPercent: clampPercent(e.target.value) })
                    }
                  />
                </LField>
              </div>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              alignItems: "start",
            }}
          >
            <LField text="When the timer ends">
              <Select
                disabled={ended}
                value={limited?.mode ?? "revert"}
                onChange={(e) =>
                  patchLimited({ mode: e.target.value as "revert" | "end" })
                }
              >
                {LIMITED_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </LField>
            <LField text="Starts" help="Leave blank to start immediately.">
              <Input
                type="datetime-local"
                disabled={ended}
                value={toLocalInput(limited?.startsAt)}
                onChange={(e) => patchLimited({ startsAt: fromLocalInput(e.target.value) })}
              />
            </LField>
            <LField text="Ends" help="Server-enforced — reverts even for unpaid carts.">
              <Input
                type="datetime-local"
                value={toLocalInput(limited?.endsAt)}
                onChange={(e) => patchLimited({ endsAt: fromLocalInput(e.target.value) })}
              />
            </LField>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Percent formatted without trailing zeros: 50, 52.6, 33.33. */
function pctStr(p: number) {
  return String(Math.round(p * 100) / 100);
}

/**
 * Three linked fields — New price / Disc % / Save — for one price. Editing any
 * one updates the other two; the source of truth is always the PERCENT (so it
 * tracks Shopify price changes). The field being typed in keeps the raw text
 * until blur so it doesn't fight the user as it reformats.
 */
function DiscountCalc({
  price,
  percent,
  onChangePercent,
}: {
  price: number;
  percent: number;
  onChangePercent: (pct: number) => void;
}) {
  type Field = "price" | "disc" | "save";
  const [active, setActive] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const newPrice = price * (1 - percent / 100);
  const save = price - newPrice;
  const disp: Record<Field, string> = {
    price: newPrice.toFixed(2),
    disc: pctStr(percent),
    save: save.toFixed(2),
  };
  const valOf = (f: Field) => (active === f ? draft : disp[f]);
  const onF = (f: Field, v: string) => {
    setActive(f);
    setDraft(v);
    if (v === "") return;
    const num = Number(v);
    if (!Number.isFinite(num)) return;
    const clampAmt = (n: number) => Math.min(Math.max(n, 0), price);
    let pct = percent;
    if (f === "price") pct = price > 0 ? ((price - clampAmt(num)) / price) * 100 : 0;
    else if (f === "save") pct = price > 0 ? (clampAmt(num) / price) * 100 : 0;
    else pct = num;
    onChangePercent(clampPercent(pct));
  };
  const onBlur = () => setActive(null);
  const field = (f: Field, label: string, suffix?: string) => {
    const common = {
      type: "text",
      inputMode: "decimal" as const,
      autoComplete: "off",
      value: valOf(f),
      onChange: (e: { target: { value: string } }) => onF(f, e.target.value),
      onBlur,
    };
    return (
      <LField text={label}>
        {suffix ? <AffixInput suffix={suffix} {...common} /> : <Input {...common} />}
      </LField>
    );
  };
  return (
    <div className="kb-calc">
      {field("price", "New price")}
      {field("disc", "Discount", "%")}
      {field("save", "Save")}
    </div>
  );
}

/**
 * Bundle pricing — ONE discount on the whole kit. A line per part shows its
 * true original (MSRP / compare-at), its current selling price, and any
 * pre-existing sale. Below: the MSRP total, the current total, then a single
 * three-way calculator that sets the bundle discount (applied on top of the
 * current selling prices, to the main and every accessory).
 */
function BundleTotals({
  group,
  lines,
  currency,
  onChange,
}: {
  group: AddonGroup;
  lines: { label: string; orig: number; now: number }[];
  currency: string;
  onChange: (patch: Partial<AddonGroup>) => void;
}) {
  const totalOrig = lines.reduce((s, l) => s + l.orig, 0); // Σ MSRP
  const totalNow = lines.reduce((s, l) => s + l.now, 0); // Σ current selling
  const pct = clampPercent(group.discountPercent); // our bundle discount
  const bundlePrice = totalNow * (1 - pct / 100);
  const totalSave = totalOrig - bundlePrice; // vs original
  const savePct = totalOrig > 0 ? (totalSave / totalOrig) * 100 : 0;
  // Reasonableness check: the kit's TOTAL discount vs its best single item's own
  // sale. If a component is already discounted more on its own than the whole
  // kit is, shoppers may find the bundle less appealing — warn and suggest a
  // bundle % that makes the kit at least as good as that item.
  let bestItemPct = 0;
  let bestItemLabel = "";
  lines.forEach((l) => {
    const p = l.orig > 0 ? ((l.orig - l.now) / l.orig) * 100 : 0;
    if (p > bestItemPct) {
      bestItemPct = p;
      bestItemLabel = l.label;
    }
  });
  const belowBestItem = bestItemPct - savePct > 0.5;
  const suggestedPct =
    totalNow > 0
      ? Math.max(
          0,
          Math.ceil((1 - (totalOrig * (1 - bestItemPct / 100)) / totalNow) * 100),
        )
      : 0;
  const priceCell = (orig: number, now: number, strong?: boolean) => (
    <span className="kb-price" style={{ flexDirection: "row", alignItems: "center" }}>
      {orig > now + 0.005 ? <s>{fmtMoney(orig, currency)}</s> : null}
      {strong ? <b>{fmtMoney(now, currency)}</b> : <span>{fmtMoney(now, currency)}</span>}
    </span>
  );
  return (
    <div className="kb-box kb-stack kb-stack--tight">
      {lines.map((l, i) => (
        <div key={i} className="kb-between kb-small">
          <span>{l.label}</span>
          {priceCell(l.orig, l.now)}
        </div>
      ))}

      <div className="kb-divider" style={{ margin: "2px 0" }} />

      <div className="kb-between">
        <span className="kb-muted kb-small">Items total</span>
        {priceCell(totalOrig, totalNow, true)}
      </div>

      <div className="kb-divider" style={{ margin: "2px 0" }} />

      <div className="kb-inline" style={{ gap: 4 }}>
        <b>Buy together — bundle discount</b>
        <InfoTip text="One discount on the whole kit — applied on top of current prices, to the main and every accessory." />
      </div>
      <DiscountCalc
        price={totalNow}
        percent={pct}
        onChangePercent={(p) => onChange({ discountPercent: clampPercent(p) })}
      />

      <div className="kb-divider" style={{ margin: "2px 0" }} />

      <div className="kb-between">
        <b>Bundle price</b>
        <b>{fmtMoney(bundlePrice, currency)}</b>
      </div>
      <div className="kb-between kb-small">
        <span className="kb-muted">You save</span>
        <span style={{ color: "var(--ok)" }}>
          {fmtMoney(totalSave, currency)}
          {savePct > 0.05 ? ` · ${pctStr(savePct)}% off` : ""}
        </span>
      </div>

      {belowBestItem ? (
        <Banner tone="warn">
          This kit’s total discount ({pctStr(savePct)}% off) is lower than “
          {bestItemLabel}”’s own sale ({pctStr(bestItemPct)}% off), so the bundle
          may look less appealing than buying that item alone. Raise the bundle
          discount to about {suggestedPct}% so the kit is the better deal.
        </Banner>
      ) : null}
    </div>
  );
}

function ArchivedSection({
  groups,
  onRestore,
  onDelete,
}: {
  groups: AddonGroup[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <List
      cols="minmax(0,1fr) auto"
      title={
        <span className="kb-inline" style={{ gap: 8 }}>
          <IconArchive />
          {`Archived (${groups.length})`}
        </span>
      }
    >
      <div className="kb-sub" style={{ padding: "10px 14px 0" }}>
        Archived groups are hidden from the storefront and grant no discount.
        Restore one to use it again, or delete it permanently. Changes apply when
        you Save.
      </div>
      {groups.map((group) => (
        <Row key={group.id}>
          <div className="kb-inline" style={{ gap: 8, minWidth: 0 }}>
            <span className="kb-code is-dim">{displayCode(group)}</span>
            <span>{group.title || "Untitled"}</span>
            <span className="kb-sub">
              {`${formLabel(group)} · ${group.accessories.length} item${group.accessories.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div className="kb-inline" style={{ flexWrap: "nowrap" }}>
            <Btn size="tiny" onClick={() => onRestore(group.id)}>
              Restore
            </Btn>
            <Btn size="tiny" variant="danger" onClick={() => onDelete(group.id)}>
              Delete
            </Btn>
          </div>
        </Row>
      ))}
    </List>
  );
}
