/**
 * Gifts module — coverage index.
 *
 * Answers "which products give which gifts" without re-expanding every campaign
 * on each page view. For every campaign we record each TRIGGER product (and how
 * it got in: listed directly, or via a collection) and each GIFT product, with
 * the product facts the management views filter on (brand, type, status, stock).
 *
 * Derived data only: GiftCampaign stays the source of truth. The index is
 * rebuilt for a campaign when it's saved, dropped when it's deleted, and can be
 * rebuilt in full on demand.
 */
import prisma from "../../db.server";
import {
  listCampaigns,
  collectionProductIds,
} from "../../models/gift-campaign.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

export type ProductFacts = {
  title: string;
  handle: string;
  image: string | null;
  vendor: string;
  productType: string;
  status: string; // ACTIVE | DRAFT | ARCHIVED | DELETED
  totalInventory: number | null;
};

/** Product facts for many ids, batched (Shopify's `nodes` caps at 250). */
async function fetchFacts(
  admin: AdminGraphql,
  ids: string[],
): Promise<Record<string, ProductFacts>> {
  const out: Record<string, ProductFacts> = {};
  for (let i = 0; i < ids.length; i += 250) {
    const batch = ids.slice(i, i + 250);
    const resp = await admin.graphql(
      `#graphql
        query GiftCoverageFacts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              handle
              vendor
              productType
              status
              totalInventory
              featuredImage { url }
            }
          }
        }`,
      { variables: { ids: batch } },
    );
    const json: any = await resp.json();
    for (const n of json?.data?.nodes ?? []) {
      if (!n?.id) continue;
      out[n.id] = {
        title: n.title ?? "",
        handle: n.handle ?? "",
        image: n.featuredImage?.url ?? null,
        vendor: n.vendor ?? "",
        productType: n.productType ?? "",
        status: n.status ?? "",
        totalInventory:
          typeof n.totalInventory === "number" ? n.totalInventory : null,
      };
    }
  }
  return out;
}

type PendingRow = {
  campaignId: string;
  productId: string;
  role: "trigger" | "gift";
  via: string[];
  fallbackTitle: string;
};

/**
 * Rebuild the index for the given campaigns (or every campaign of the shop).
 * Products that no longer exist are kept, flagged DELETED, so a campaign that
 * still references them is visible in the views rather than silently shrinking.
 */
export async function rebuildCoverage(
  admin: AdminGraphql,
  shop: string,
  onlyCampaignIds?: string[],
): Promise<{ campaigns: number; triggers: number; gifts: number }> {
  const all = await listCampaigns(shop);
  const campaigns = onlyCampaignIds
    ? all.filter((c) => onlyCampaignIds.includes(c.id))
    : all;

  const pending: PendingRow[] = [];
  for (const c of campaigns) {
    const via = new Map<string, { labels: Set<string>; title: string }>();
    const add = (pid: string, label: string, title = "") => {
      const cur = via.get(pid) ?? { labels: new Set<string>(), title };
      cur.labels.add(label);
      if (!cur.title && title) cur.title = title;
      via.set(pid, cur);
    };
    for (const p of c.triggerProducts) add(p.id, "Direct", p.title);
    for (const coll of c.triggerCollections) {
      const label = `Collection: ${coll.title || "Untitled"}`;
      for (const pid of await collectionProductIds(admin, coll.id)) {
        add(pid, label);
      }
    }
    for (const [pid, v] of via) {
      pending.push({
        campaignId: c.id,
        productId: pid,
        role: "trigger",
        via: [...v.labels],
        fallbackTitle: v.title,
      });
    }
    for (const g of c.giftProducts) {
      pending.push({
        campaignId: c.id,
        productId: g.id,
        role: "gift",
        via: [],
        fallbackTitle: g.title,
      });
    }
  }

  const facts = await fetchFacts(admin, [
    ...new Set(pending.map((r) => r.productId)),
  ]);

  const data = pending.map((r) => {
    const f = facts[r.productId];
    return {
      shop,
      campaignId: r.campaignId,
      productId: r.productId,
      role: r.role,
      viaJson: JSON.stringify(r.via),
      title: f?.title ?? r.fallbackTitle ?? "",
      handle: f?.handle ?? "",
      image: f?.image ?? null,
      vendor: f?.vendor ?? "",
      productType: f?.productType ?? "",
      status: f ? f.status : "DELETED",
      totalInventory: f?.totalInventory ?? null,
    };
  });

  await prisma.$transaction([
    prisma.giftCoverage.deleteMany({
      where: onlyCampaignIds
        ? { shop, campaignId: { in: onlyCampaignIds } }
        : { shop },
    }),
    prisma.giftCoverage.createMany({ data, skipDuplicates: true }),
  ]);

  return {
    campaigns: campaigns.length,
    triggers: data.filter((d) => d.role === "trigger").length,
    gifts: data.filter((d) => d.role === "gift").length,
  };
}

/** Forget a deleted campaign's rows. */
export async function dropCoverage(shop: string, campaignId: string) {
  await prisma.giftCoverage.deleteMany({ where: { shop, campaignId } });
}

/**
 * Make sure the index exists before a view reads it: build it once if the shop
 * has campaigns but no rows yet (first visit after this feature shipped).
 */
export async function ensureCoverage(admin: AdminGraphql, shop: string) {
  const [rows, campaigns] = await Promise.all([
    prisma.giftCoverage.count({ where: { shop } }),
    prisma.giftCampaign.count({ where: { shop } }),
  ]);
  if (rows === 0 && campaigns > 0) await rebuildCoverage(admin, shop);
}

/** When the index was last written (for the "updated …" line in the views). */
export async function coverageUpdatedAt(shop: string): Promise<string | null> {
  const r = await prisma.giftCoverage.findFirst({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return r ? r.updatedAt.toISOString() : null;
}
