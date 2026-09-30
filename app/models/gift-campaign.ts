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
  /** false = paused. */
  enabled: boolean;
  /** Saved but never published — nothing on the storefront. */
  draft: boolean;
  startsAt: string; // ISO-8601 or ""
  endsAt: string; // ISO-8601 or ""
  /**
   * Free units of EACH gift per qualifying unit (q). Buy 2 mains with q = 1 →
   * 2 of each chosen gift.
   */
  perQualifying: number;
  /**
   * "fixed"  = (retired in the editor) only the first gift is offered.
   * "choice" = customer picks `chooseCount` gifts from the set.
   * "all"    = every gift is auto-added; a multi-variant gift still lets the
   *            customer choose its variant, and one "No thanks" declines the set.
   */
  rewardMode: "fixed" | "choice" | "all";
  /** Choice mode: how many different gifts the customer picks (k). */
  chooseCount: number;
  /** Overlaps: higher wins when campaigns don't combine. */
  priority: number;
  /** Never combines with other campaigns on the same product. */
  exclusive: boolean;
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
  state: CampaignState;
  badge: string;
  perQualifying: number;
  gifts: { title: string; image: string | null }[];
};

/**
 * Which of the campaigns on ONE product are actually given (same rule in the
 * discount Function and the storefront, which apply it to the campaigns live
 * today). Highest priority first (ties keep the given order):
 * - the top campaign is exclusive → only it;
 * - otherwise → every non-exclusive campaign (exclusive ones don't combine).
 */
export function overlapWinners<T extends { priority?: number; exclusive?: boolean }>(
  list: T[],
): T[] {
  if (list.length <= 1) return list.slice();
  const sorted = list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (Number(b.c.priority) || 0) - (Number(a.c.priority) || 0) || a.i - b.i)
    .map((x) => x.c);
  if (sorted[0].exclusive) return [sorted[0]];
  return sorted.filter((c) => !c.exclusive);
}

/** The effective reward rule: k different gifts, q of each, per qualifying unit. */
export function rewardRule(c: GiftCampaign): { k: number; q: number; n: number } {
  const n = c.giftProducts.length;
  const k =
    c.rewardMode === "all"
      ? Math.max(1, n)
      : c.rewardMode === "choice"
        ? Math.max(1, Math.min(c.chooseCount || 1, Math.max(1, n)))
        : 1;
  return { k, q: Math.max(1, c.perQualifying || 1), n };
}

/** Plain-English reward summary ("Pick 2 of 5 gifts · 1 of each per item"). */
export function rewardSummary(c: GiftCampaign): string {
  const { k, q, n } = rewardRule(c);
  const each = `${q} of each per item bought`;
  if (c.rewardMode === "all") return `Every gift (${n}) · ${each}`;
  if (c.rewardMode === "choice")
    return k > 1 ? `Pick ${k} of ${n} gifts · ${each}` : `Pick 1 of ${n} gifts · ${q} per item bought`;
  return `First gift auto-added · ${q} per item bought`;
}

export function newCampaignId() {
  return `camp_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyCampaign(): GiftCampaign {
  return {
    id: newCampaignId(),
    title: "",
    enabled: true,
    draft: false,
    startsAt: "",
    endsAt: "",
    perQualifying: 1,
    rewardMode: "choice",
    chooseCount: 1,
    priority: 0,
    exclusive: false,
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

export type CampaignState = "draft" | "paused" | "scheduled" | "active" | "ended";

/** Live state of a campaign (draft / paused are manual; the rest follow the dates). */
export function campaignState(
  c: Pick<GiftCampaign, "enabled" | "startsAt" | "endsAt"> & { draft?: boolean },
  now = Date.now(),
): CampaignState {
  if (c.draft) return "draft";
  if (!c.enabled) return "paused";
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
    draft: !!row.draft,
    startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : "",
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : "",
    // Legacy All-mode rows ignored perQualifying (one of each gift per unit).
    perQualifying:
      row.rewardMode === "all" && (Number(row.rulesVersion) || 1) < 2
        ? 1
        : Math.max(1, Number(row.perQualifying) || 1),
    chooseCount: Math.max(1, Number(row.chooseCount) || 1),
    priority: Math.trunc(Number(row.priority) || 0),
    exclusive: !!row.exclusive,
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
