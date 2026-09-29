/**
 * Gifts module — read models for the management views, built from the coverage
 * index + campaign states. Plain serialisable objects for Remix loaders.
 */
import prisma from "../../db.server";
import { listCampaigns } from "../../models/gift-campaign.server";
import { campaignState } from "../../models/gift-campaign";

export type CampaignState = "active" | "scheduled" | "ended" | "disabled";

export type CampaignMeta = {
  id: string;
  title: string;
  state: CampaignState;
};

export type MiniProduct = {
  productId: string;
  title: string;
  image: string | null;
};

export type ProductRow = {
  productId: string;
  numericId: string;
  title: string;
  handle: string;
  image: string | null;
  vendor: string;
  productType: string;
  status: string;
  via: string[];
  campaigns: CampaignMeta[];
  gifts: MiniProduct[];
  /** Campaigns giving this product a gift right now. >1 = overlap to check. */
  activeCampaigns: number;
};

export type GiftRow = {
  productId: string;
  numericId: string;
  title: string;
  image: string | null;
  vendor: string;
  status: string;
  totalInventory: number | null;
  campaigns: CampaignMeta[];
  /** Distinct trigger products that give this gift (any campaign state). */
  triggerCount: number;
  /** …only in campaigns that are active now. */
  activeTriggerCount: number;
};

export type BrandRow = {
  vendor: string;
  productCount: number;
  activeProductCount: number;
  giftCount: number;
  campaigns: CampaignMeta[];
};

const tail = (gid: string) => String(gid).split("/").pop() || "";

export async function buildGiftViews(shop: string) {
  const [campaigns, rows] = await Promise.all([
    listCampaigns(shop),
    prisma.giftCoverage.findMany({ where: { shop } }),
  ]);

  const meta = new Map<string, CampaignMeta>();
  for (const c of campaigns) {
    meta.set(c.id, {
      id: c.id,
      title: c.title || "Untitled campaign",
      state: campaignState(c) as CampaignState,
    });
  }

  const triggers = rows.filter((r) => r.role === "trigger" && meta.has(r.campaignId));
  const gifts = rows.filter((r) => r.role === "gift" && meta.has(r.campaignId));

  // campaign -> its gift products
  const giftsByCampaign = new Map<string, MiniProduct[]>();
  for (const g of gifts) {
    const arr = giftsByCampaign.get(g.campaignId) ?? [];
    arr.push({ productId: g.productId, title: g.title, image: g.image });
    giftsByCampaign.set(g.campaignId, arr);
  }
  // campaign -> its trigger product ids
  const triggersByCampaign = new Map<string, Set<string>>();
  for (const t of triggers) {
    const s = triggersByCampaign.get(t.campaignId) ?? new Set<string>();
    s.add(t.productId);
    triggersByCampaign.set(t.campaignId, s);
  }

  // ---- Products (one row per trigger product) ----
  const byProduct = new Map<string, ProductRow>();
  for (const t of triggers) {
    const m = meta.get(t.campaignId)!;
    let row = byProduct.get(t.productId);
    if (!row) {
      row = {
        productId: t.productId,
        numericId: tail(t.productId),
        title: t.title,
        handle: t.handle,
        image: t.image,
        vendor: t.vendor,
        productType: t.productType,
        status: t.status,
        via: [],
        campaigns: [],
        gifts: [],
        activeCampaigns: 0,
      };
      byProduct.set(t.productId, row);
    }
    row.campaigns.push(m);
    if (m.state === "active") row.activeCampaigns += 1;
    for (const v of JSON.parse(t.viaJson || "[]") as string[]) {
      if (!row.via.includes(v)) row.via.push(v);
    }
    for (const g of giftsByCampaign.get(t.campaignId) ?? []) {
      if (!row.gifts.some((x) => x.productId === g.productId)) row.gifts.push(g);
    }
  }
  const products = [...byProduct.values()].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  // ---- Gifts (one row per gift product) ----
  const byGift = new Map<string, GiftRow & { _t: Set<string>; _a: Set<string> }>();
  for (const g of gifts) {
    const m = meta.get(g.campaignId)!;
    let row = byGift.get(g.productId);
    if (!row) {
      row = {
        productId: g.productId,
        numericId: tail(g.productId),
        title: g.title,
        image: g.image,
        vendor: g.vendor,
        status: g.status,
        totalInventory: g.totalInventory,
        campaigns: [],
        triggerCount: 0,
        activeTriggerCount: 0,
        _t: new Set<string>(),
        _a: new Set<string>(),
      };
      byGift.set(g.productId, row);
    }
    if (!row.campaigns.some((c) => c.id === m.id)) row.campaigns.push(m);
    for (const pid of triggersByCampaign.get(g.campaignId) ?? []) {
      row._t.add(pid);
      if (m.state === "active") row._a.add(pid);
    }
  }
  const giftRows: GiftRow[] = [...byGift.values()]
    .map(({ _t, _a, ...r }) => ({
      ...r,
      triggerCount: _t.size,
      activeTriggerCount: _a.size,
    }))
    .sort((a, b) => b.activeTriggerCount - a.activeTriggerCount || a.title.localeCompare(b.title));

  // ---- Brands (group trigger products by vendor) ----
  const byBrand = new Map<
    string,
    { products: Set<string>; active: Set<string>; gifts: Set<string>; camps: Map<string, CampaignMeta> }
  >();
  for (const p of products) {
    const key = p.vendor || "";
    const b = byBrand.get(key) ?? {
      products: new Set<string>(),
      active: new Set<string>(),
      gifts: new Set<string>(),
      camps: new Map<string, CampaignMeta>(),
    };
    b.products.add(p.productId);
    if (p.activeCampaigns > 0) b.active.add(p.productId);
    for (const g of p.gifts) b.gifts.add(g.productId);
    for (const c of p.campaigns) b.camps.set(c.id, c);
    byBrand.set(key, b);
  }
  const brands: BrandRow[] = [...byBrand.entries()]
    .map(([vendor, b]) => ({
      vendor,
      productCount: b.products.size,
      activeProductCount: b.active.size,
      giftCount: b.gifts.size,
      campaigns: [...b.camps.values()],
    }))
    .sort((a, b) => b.productCount - a.productCount || a.vendor.localeCompare(b.vendor));

  // Per-campaign coverage counts (for the campaign list).
  const coverageCount: Record<string, number> = {};
  for (const [cid, set] of triggersByCampaign) coverageCount[cid] = set.size;

  return {
    campaigns: [...meta.values()],
    products,
    gifts: giftRows,
    brands,
    coverageCount,
  };
}
