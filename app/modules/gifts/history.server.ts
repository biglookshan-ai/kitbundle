/**
 * Gifts module — campaign change history: what changed and when, written on
 * every save / duplicate / delete. (The app's session is the store, not a staff
 * member, so "who" isn't known.)
 */
import prisma from "../../db.server";
import { giftQty, type GiftCampaign, type Ref } from "../../models/gift-campaign";

const state = (c: GiftCampaign) => (c.draft ? "draft" : c.enabled ? "published" : "paused");

function fmt(iso: string, tz: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function refDiff(label: string, a: Ref[], b: Ref[]): string[] {
  const ai = new Set(a.map((r) => r.id));
  const bi = new Set(b.map((r) => r.id));
  const added = b.filter((r) => !ai.has(r.id)).map((r) => r.title || r.handle || "item");
  const removed = a.filter((r) => !bi.has(r.id)).map((r) => r.title || r.handle || "item");
  const out: string[] = [];
  if (added.length) out.push(`${label} added: ${added.join(", ")}`);
  if (removed.length) out.push(`${label} removed: ${removed.join(", ")}`);
  return out;
}

function listDiff(label: string, a: string[], b: string[]): string[] {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  const added = b.filter((x) => !A.has(x.toLowerCase()));
  const removed = a.filter((x) => !B.has(x.toLowerCase()));
  const out: string[] = [];
  if (added.length) out.push(`${label} added: ${added.join(", ")}`);
  if (removed.length) out.push(`${label} removed: ${removed.join(", ")}`);
  return out;
}

/** Plain-English list of what changed between two versions of a campaign. */
export function describeChanges(prev: GiftCampaign, next: GiftCampaign, tz: string): string[] {
  const out: string[] = [];
  if (state(prev) !== state(next))
    out.push(
      state(next) === "published" ? "Published" : state(next) === "paused" ? "Paused" : "Moved to draft",
    );
  if (prev.title !== next.title) out.push(`Renamed to “${next.title || "Untitled"}”`);
  if (prev.startsAt !== next.startsAt)
    out.push(next.startsAt ? `Start set to ${fmt(next.startsAt, tz)}` : "Start date removed");
  if (prev.endsAt !== next.endsAt)
    out.push(next.endsAt ? `End set to ${fmt(next.endsAt, tz)}` : "End date removed");
  if (prev.allProducts !== next.allProducts)
    out.push(next.allProducts ? "Now triggers on all products" : "No longer triggers on all products");
  out.push(...refDiff("Trigger products", prev.triggerProducts, next.triggerProducts));
  out.push(...refDiff("Trigger collections", prev.triggerCollections, next.triggerCollections));
  out.push(...listDiff("Tag filters", prev.triggerTags, next.triggerTags));
  out.push(...listDiff("Brand filters", prev.triggerVendors, next.triggerVendors));
  out.push(...listDiff("Type filters", prev.triggerTypes, next.triggerTypes));
  out.push(...refDiff("Excluded products", prev.excludeProducts, next.excludeProducts));
  out.push(...refDiff("Excluded collections", prev.excludeCollections, next.excludeCollections));
  out.push(...listDiff("Excluded tags", prev.excludeTags, next.excludeTags));
  out.push(...listDiff("Excluded brands", prev.excludeVendors, next.excludeVendors));
  out.push(...listDiff("Excluded types", prev.excludeTypes, next.excludeTypes));
  out.push(...refDiff("Gifts", prev.giftProducts, next.giftProducts));
  for (const g of next.giftProducts) {
    const before = prev.giftProducts.find((x) => x.id === g.id);
    if (before && giftQty(before) !== giftQty(g)) out.push(`${g.title || "Gift"} quantity ${giftQty(before)} → ${giftQty(g)}`);
  }
  if (prev.rewardMode !== next.rewardMode || prev.chooseCount !== next.chooseCount)
    out.push(
      next.rewardMode === "all"
        ? "Reward: give every gift"
        : next.rewardMode === "choice"
          ? `Reward: customer chooses ${next.chooseCount}`
          : "Reward: first gift only",
    );
  if (prev.priority !== next.priority) out.push(`Priority ${prev.priority} → ${next.priority}`);
  if (prev.exclusive !== next.exclusive)
    out.push(next.exclusive ? "Set to exclusive (doesn't combine)" : "Now combines with other campaigns");
  if (prev.badgeText !== next.badgeText || prev.subtitle !== next.subtitle || prev.hideWhenSoldOut !== next.hideWhenSoldOut)
    out.push("Storefront settings changed");
  return out;
}

/** One-line description of a new campaign. */
export function describeNew(c: GiftCampaign, tz: string): string[] {
  const out = [`Status: ${state(c)}`];
  if (c.startsAt) out.push(`Starts ${fmt(c.startsAt, tz)}`);
  if (c.endsAt) out.push(`Ends ${fmt(c.endsAt, tz)}`);
  if (c.giftProducts.length)
    out.push(`Gifts: ${c.giftProducts.map((g) => `${giftQty(g) > 1 ? `${giftQty(g)} × ` : ""}${g.title || g.handle}`).join(", ")}`);
  return out;
}

export async function logEvent(
  shop: string,
  campaignId: string,
  title: string,
  action: "created" | "updated" | "duplicated" | "deleted",
  lines: string[],
) {
  await prisma.giftCampaignEvent
    .create({
      data: { shop, campaignId, title, action, summary: lines.join("\n").slice(0, 4000) },
    })
    .catch((e) => console.error("[gifts] history write failed", e));
}

export async function listEvents(shop: string, campaignId: string, take = 50) {
  const rows = await prisma.giftCampaignEvent.findMany({
    where: { shop, campaignId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    action: r.action,
    lines: r.summary ? r.summary.split("\n") : [],
  }));
}
