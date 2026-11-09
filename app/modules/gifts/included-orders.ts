/**
 * "Added to the order only" campaigns (2026-11-09) — which parts an order gets.
 *
 * Shoppers never see these parts. Right after an order is placed we add them to
 * it at £0, so the packing slip / EasyScan / stock treat them like any line
 * (the effect Bundles.app kits had). Same rules as the discount Function, read
 * from the trigger product's `custom.gift_trigger` stamp (entries with
 * `order: true`): live on the order's store-local date, trigger variant
 * allowed, overlapping order-only campaigns resolved by priority / exclusive.
 * Every gift is added: line qty × that gift's qty.
 */

export type OrderLine = {
  productTitle: string;
  variantTitle: string;
  variantId: string; // gid or numeric
  quantity: number;
  /** Raw `custom.gift_trigger` JSON of the line's product. */
  stamp: string | null;
  /** Line item properties (customAttributes). */
  props: Record<string, string>;
};

export type PartNeed = {
  /** Numeric product id of the part. */
  productTail: string;
  quantity: number;
  /** Numeric variant ids the campaign allows (empty = any). */
  variantTails: string[];
  campaignIds: string[];
  /** "Smart Fusion (Smart Fusion + Motor)" — what it came with. */
  withTitles: string[];
};

const tail = (id: unknown) => String(id ?? "").split("/").pop() || "";

export function dateOk(e: any, today: string) {
  if (!today) return true;
  const start =
    (typeof e.startDate === "string" && e.startDate) ||
    (typeof e.startsAt === "string" ? e.startsAt.slice(0, 10) : "");
  const end =
    (typeof e.endDate === "string" && e.endDate) ||
    (typeof e.endsAt === "string" ? e.endsAt.slice(0, 10) : "");
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

function overlapWinners(list: any[]) {
  if (list.length <= 1) return list;
  const sorted = list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (Number(b.c.priority) || 0) - (Number(a.c.priority) || 0) || a.i - b.i)
    .map((x) => x.c);
  if (sorted[0].exclusive) return [sorted[0]];
  return sorted.filter((c) => !c.exclusive);
}

function giftQtyOf(e: any, t: string) {
  const per = e?.giftQty && Number(e.giftQty[t]);
  return per >= 1 ? Math.floor(per) : 1;
}

/** Order-only entries on a stamp (none → []). */
export function orderEntries(stamp: string | null | undefined): any[] {
  if (!stamp) return [];
  try {
    const arr = JSON.parse(stamp);
    return Array.isArray(arr) ? arr.filter((e) => e && e.id && e.order && e.kind !== "deal") : [];
  } catch {
    return [];
  }
}

/** Parts to add to an order. `today` = the order's store-local YYYY-MM-DD. */
export function planParts(lines: OrderLine[], today: string): PartNeed[] {
  const out = new Map<string, PartNeed>();
  for (const line of lines) {
    // Gift / kit lines aren't triggers.
    if (line.props._cgp_gift || line.props._addon_for) continue;
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (!qty) continue;
    const vid = tail(line.variantId);
    const valid = orderEntries(line.stamp).filter(
      (e) =>
        dateOk(e, today) &&
        !(
          Array.isArray(e.triggerVariants) &&
          e.triggerVariants.length &&
          !e.triggerVariants.map(String).includes(vid)
        ),
    );
    const label =
      line.variantTitle && line.variantTitle !== "Default Title"
        ? `${line.productTitle} (${line.variantTitle})`
        : line.productTitle;
    for (const e of overlapWinners(valid)) {
      for (const t of (Array.isArray(e.giftIds) ? e.giftIds : []).map(String)) {
        const cur =
          out.get(t) ??
          ({
            productTail: t,
            quantity: 0,
            variantTails: (e.giftVariants?.[t] ?? []).map(String),
            campaignIds: [],
            withTitles: [],
          } as PartNeed);
        cur.quantity += qty * giftQtyOf(e, t);
        if (!cur.campaignIds.includes(e.id)) cur.campaignIds.push(e.id);
        if (!cur.withTitles.includes(label)) cur.withTitles.push(label);
        out.set(t, cur);
      }
    }
  }
  return [...out.values()].filter((p) => p.quantity > 0);
}

/** Pick the variant to add: an allowed one, preferring one that's in stock. */
export function pickVariant(
  variants: { id: string; availableForSale?: boolean }[],
  allowedTails: string[],
): string | null {
  const allowed = allowedTails.length
    ? variants.filter((v) => allowedTails.includes(tail(v.id)))
    : variants;
  const pick = allowed.find((v) => v.availableForSale) ?? allowed[0];
  return pick ? pick.id : null;
}
