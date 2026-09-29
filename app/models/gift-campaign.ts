/**
 * Shared, client-safe types + helpers for Gift Campaigns (cross-product "gift
 * with purchase"). No server-only imports so React can use it.
 */

// Node metafield the Function reads (one node per campaign, time-gated).
export const GIFT_NODE_NAMESPACE = "$app:gift";
export const GIFT_NODE_KEY = "campaign";
// Product metafield stamped on trigger products: JSON array of campaign ids.
export const GIFT_TRIGGER_NAMESPACE = "custom";
export const GIFT_TRIGGER_KEY = "gift_trigger";

export type Ref = {
  id: string; // gid://shopify/Product/... or Collection/...
  title: string;
  handle: string;
  image?: string | null;
  /**
   * Gift products only: which variants (variant gids) are offered free. Undefined
   * or empty = every variant is eligible. When more than one is offered the
   * storefront makes the customer pick one; the discount Function enforces the
   * set so an off-list variant can't be claimed free.
   */
  variantIds?: string[];
};

export type GiftCampaign = {
  id: string; // camp_xxxx
  title: string;
  enabled: boolean;
  startsAt: string; // ISO-8601 or ""
  endsAt: string; // ISO-8601 or ""
  /** Free gifts granted per qualifying unit (buy 2 -> 2). */
  perQualifying: number;
  /**
   * "fixed"  = auto-add the single (first) gift.
   * "choice" = customer picks one gift from the set.
   * "all"    = every gift is auto-added; a multi-variant gift still lets the
   *            customer choose its variant, and one "No thanks" declines the set.
   */
  rewardMode: "fixed" | "choice" | "all";
  badgeText: string;
  /** Storefront prompt shown above the gift picker (customizable per campaign). */
  subtitle: string;
  /** Hide sold-out gifts (and the whole group when all are sold out). */
  hideWhenSoldOut: boolean;
  triggerProducts: Ref[]; // manual product list
  triggerCollections: Ref[]; // Shopify collections (kept in sync by webhooks)
  /** Rule-based triggers, matched case-insensitively. */
  triggerTags: string[];
  triggerVendors: string[];
  triggerTypes: string[];
  /** Every product in the store triggers. */
  allProducts: boolean;
  /**
   * Carve-outs from the rule-based triggers (collections / tags / brands /
   * types / all). Directly listed trigger products are never excluded.
   */
  excludeTags: string[];
  excludeProducts: Ref[];
  giftProducts: Ref[]; // the gift set
};

/** True when the campaign has at least one way to trigger. */
export function hasTrigger(c: GiftCampaign): boolean {
  return (
    c.allProducts ||
    c.triggerProducts.length > 0 ||
    c.triggerCollections.length > 0 ||
    c.triggerTags.length > 0 ||
    c.triggerVendors.length > 0 ||
    c.triggerTypes.length > 0
  );
}

/** Short human summary of what triggers a campaign ("2 products, tag: sale"). */
export function triggerSummary(c: GiftCampaign): string {
  if (c.allProducts) return "All products";
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (c.triggerProducts.length) parts.push(n(c.triggerProducts.length, "product"));
  if (c.triggerCollections.length) parts.push(n(c.triggerCollections.length, "collection"));
  if (c.triggerTags.length) parts.push(n(c.triggerTags.length, "tag"));
  if (c.triggerVendors.length) parts.push(n(c.triggerVendors.length, "brand"));
  if (c.triggerTypes.length) parts.push(n(c.triggerTypes.length, "type"));
  return parts.join(", ") || "No trigger";
}

/** Compact read-only view of a gift a product triggers, for the product editor. */
export type ProductGiftInfo = {
  id: string;
  title: string;
  state: "disabled" | "scheduled" | "active" | "ended";
  badge: string;
  perQualifying: number;
  gifts: { title: string; image: string | null }[];
};

export function newCampaignId() {
  return `camp_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyCampaign(): GiftCampaign {
  return {
    id: newCampaignId(),
    title: "",
    enabled: true,
    startsAt: "",
    endsAt: "",
    perQualifying: 1,
    rewardMode: "fixed",
    badgeText: "🎁 Free gift",
    subtitle: "Choose your free gift:",
    hideWhenSoldOut: false,
    triggerProducts: [],
    triggerCollections: [],
    triggerTags: [],
    triggerVendors: [],
    triggerTypes: [],
    allProducts: false,
    excludeTags: [],
    excludeProducts: [],
    giftProducts: [],
  };
}

/** Live state of a campaign's schedule. */
export function campaignState(
  c: Pick<GiftCampaign, "enabled" | "startsAt" | "endsAt">,
): "disabled" | "scheduled" | "active" | "ended" {
  if (!c.enabled) return "disabled";
  const now = Date.now();
  const s = c.startsAt ? Date.parse(c.startsAt) : NaN;
  const e = c.endsAt ? Date.parse(c.endsAt) : NaN;
  if (!Number.isNaN(e) && now >= e) return "ended";
  if (!Number.isNaN(s) && now < s) return "scheduled";
  return "active";
}

function parseRefs(json: string | null | undefined): Ref[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr)
      ? arr
          .filter((r: any) => typeof r?.id === "string")
          .map((r: any) => ({
            id: r.id,
            title: typeof r.title === "string" ? r.title : "",
            handle: typeof r.handle === "string" ? r.handle : "",
            image: r.image ?? null,
            variantIds: Array.isArray(r.variantIds)
              ? r.variantIds.filter((x: any) => typeof x === "string")
              : undefined,
          }))
      : [];
  } catch {
    return [];
  }
}

/** A JSON array of non-empty, trimmed, de-duplicated (case-insensitive) strings. */
export function cleanStrings(v: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function parseStrings(json: string | null | undefined): string[] {
  try {
    return cleanStrings(JSON.parse(json || "[]"));
  } catch {
    return [];
  }
}

/** Build a GiftCampaign from a Prisma row (shape-compatible). */
export function rowToCampaign(row: any): GiftCampaign {
  return {
    id: row.id,
    title: row.title ?? "",
    enabled: !!row.enabled,
    startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : "",
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : "",
    perQualifying: Math.max(1, Number(row.perQualifying) || 1),
    rewardMode:
      row.rewardMode === "choice"
        ? "choice"
        : row.rewardMode === "all"
          ? "all"
          : "fixed",
    badgeText: row.badgeText ?? "",
    subtitle: row.subtitle ?? "",
    hideWhenSoldOut: !!row.hideWhenSoldOut,
    triggerProducts: parseRefs(row.triggerProductsJson),
    triggerCollections: parseRefs(row.triggerCollectionsJson),
    triggerTags: parseStrings(row.triggerTagsJson),
    triggerVendors: parseStrings(row.triggerVendorsJson),
    triggerTypes: parseStrings(row.triggerTypesJson),
    allProducts: !!row.allProducts,
    excludeTags: parseStrings(row.excludeTagsJson),
    excludeProducts: parseRefs(row.excludeProductsJson),
    giftProducts: parseRefs(row.giftProductsJson),
  };
}
