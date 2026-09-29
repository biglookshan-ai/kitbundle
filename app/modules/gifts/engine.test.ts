/**
 * Gift sync engine — end to end against an in-memory store + fake Admin API.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------- in-memory prisma ---------------- */
type Row = Record<string, any>;
const { db, table } = vi.hoisted(() => {
  const db: Record<string, Record<string, any>[]> = {};
  const match = (r: Record<string, any>, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "shop_productId") return r.shop === v.shop && r.productId === v.productId;
      if (v && typeof v === "object" && "in" in v) return v.in.includes(r[k]);
      return r[k] === v;
    });
  const table = (name: string) => ({
    findMany: async (a: Record<string, any> = {}) => {
      let rows = (db[name] ??= []).filter((r) => match(r, a.where));
      if (a.orderBy?.createdAt === "desc") rows = [...rows].reverse();
      if (a.skip) rows = rows.slice(a.skip);
      return rows;
    },
    findFirst: async (a: Record<string, any> = {}) => (await table(name).findMany(a))[0] ?? null,
    count: async (a: Record<string, any> = {}) => (db[name] ??= []).filter((r) => match(r, a.where)).length,
    create: async (a: Record<string, any>) => {
      (db[name] ??= []).push({ createdAt: new Date(), ...a.data });
    },
    createMany: async (a: Record<string, any>) => {
      (db[name] ??= []).push(...a.data);
    },
    deleteMany: async (a: Record<string, any> = {}) => {
      db[name] = (db[name] ??= []).filter((r) => !match(r, a.where));
    },
    updateMany: async (a: Record<string, any>) => {
      for (const r of (db[name] ??= []).filter((r) => match(r, a.where))) Object.assign(r, a.data);
    },
    upsert: async (a: Record<string, any>) => {
      const r = (db[name] ??= []).find((x) => match(x, a.where));
      if (r) Object.assign(r, a.update);
      else db[name].push({ ...a.create });
    },
  });
  return { db, table };
});
vi.mock("../../db.server", () => ({
  default: {
    giftCampaign: table("giftCampaign"),
    giftCoverage: table("giftCoverage"),
    giftStamp: table("giftStamp"),
    giftSyncLog: table("giftSyncLog"),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));
vi.mock("../../shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));

import { syncAll, syncProduct } from "./engine.server";

/* ---------------- fake store ---------------- */
const P = (n: number) => `gid://shopify/Product/${n}`;
const C1 = "gid://shopify/Collection/1";
type Prod = { id: string; tags: string[]; vendor: string; productType: string; colls: string[] };
let products: Prod[];
let stamps: Record<string, string>;
let writes: string[];

const node = (p: Prod) => ({
  id: p.id,
  title: `Product ${p.id.split("/").pop()}`,
  handle: `p${p.id.split("/").pop()}`,
  vendor: p.vendor,
  productType: p.productType,
  status: "ACTIVE",
  totalInventory: 5,
  tags: p.tags,
  featuredImage: null,
});
const conn = (list: Prod[]) => ({ nodes: list.map(node), pageInfo: { hasNextPage: false } });
const reply = (data: any) => ({ json: async () => ({ data }) }) as unknown as Response;

const admin = {
  graphql: async (query: string, opts?: { variables?: any }) => {
    const v = opts?.variables ?? {};
    if (query.includes("ShopTz")) return reply({ shop: { ianaTimezone: "Europe/London" } });
    if (query.includes("GiftColl"))
      return reply({ collection: { products: conn(products.filter((p) => p.colls.includes(v.id))) } });
    if (query.includes("GiftSearch")) {
      const m = /^(\w+):"(.*)"$/.exec(v.q ?? "");
      const hit = (p: Prod) =>
        !m ||
        (m[1] === "tag" && p.tags.includes(m[2])) ||
        (m[1] === "vendor" && p.vendor.toLowerCase() === m[2].toLowerCase()) ||
        (m[1] === "product_type" && p.productType === m[2]);
      return reply({ products: conn(products.filter(hit)) });
    }
    if (query.includes("GiftFacts"))
      return reply({ nodes: v.ids.map((id: string) => products.find((p) => p.id === id)).filter(Boolean).map(node) });
    if (query.includes("GiftOne")) {
      const p = products.find((x) => x.id === v.id);
      return reply({
        product: p
          ? { ...node(p), collections: { nodes: p.colls.map((id) => ({ id })) }, metafield: stamps[p.id] ? { value: stamps[p.id] } : null }
          : null,
      });
    }
    if (query.includes("GiftStamps")) {
      for (const m of v.metafields) {
        stamps[m.ownerId] = m.value;
        writes.push(m.ownerId);
      }
      return reply({ metafieldsSet: { userErrors: [] } });
    }
    throw new Error(`unexpected query ${query.slice(0, 60)}`);
  },
};

const campaign = (id: string, extra: Row) => ({
  id,
  shop: "s",
  title: id,
  enabled: true,
  startsAt: null,
  endsAt: null,
  perQualifying: 1,
  rewardMode: "fixed",
  badgeText: "",
  subtitle: "",
  hideWhenSoldOut: false,
  triggerProductsJson: "[]",
  triggerCollectionsJson: "[]",
  triggerTagsJson: "[]",
  triggerVendorsJson: "[]",
  triggerTypesJson: "[]",
  allProducts: false,
  excludeTagsJson: "[]",
  excludeProductsJson: "[]",
  giftProductsJson: JSON.stringify([{ id: P(99), title: "Gift", handle: "gift" }]),
  ...extra,
});
const ids = (pid: string) => JSON.parse(stamps[pid] ?? "[]").map((e: any) => e.id);

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  products = [
    { id: P(1), tags: ["sale"], vendor: "DZOFILM", productType: "Lens", colls: [C1] },
    { id: P(2), tags: ["sale", "clearance"], vendor: "Tilta", productType: "Focus", colls: [C1] },
    { id: P(3), tags: [], vendor: "DZOFILM", productType: "Lens", colls: [] },
    { id: P(4), tags: [], vendor: "Other", productType: "Cage", colls: [] },
    { id: P(99), tags: [], vendor: "Gifts", productType: "Gift", colls: [] },
  ];
  stamps = {};
  writes = [];
  db.giftCampaign = [
    campaign("A", { triggerTagsJson: '["sale"]', excludeTagsJson: '["clearance"]' }),
    campaign("B", { triggerVendorsJson: '["dzofilm"]' }),
    campaign("C", {
      triggerCollectionsJson: JSON.stringify([{ id: C1, title: "Lenses", handle: "lenses" }]),
      triggerProductsJson: JSON.stringify([
        { id: P(4), title: "P4", handle: "p4", variantIds: ["gid://shopify/ProductVariant/41"] },
      ]),
      excludeProductsJson: JSON.stringify([{ id: P(2), title: "P2", handle: "p2" }]),
    }),
    campaign("D", { enabled: false, allProducts: true }),
  ];
});

describe("gift sync engine", () => {
  it("resolves tags, brands, collections, direct picks and exclusions", async () => {
    const r = await syncAll(admin, "s");
    expect(r.errors).toEqual([]);
    expect(ids(P(1))).toEqual(["A", "B", "C"]);
    expect(stamps[P(2)]).toBeUndefined(); // excluded by tag (A) and by product (C)
    expect(ids(P(3))).toEqual(["B"]); // brand match is case-insensitive
    const p4 = JSON.parse(stamps[P(4)]);
    expect(p4.map((e: any) => e.id)).toEqual(["C"]);
    expect(p4[0].triggerVariants).toEqual(["41"]);
    expect(p4[0].triggers).toBeUndefined(); // no more trigger id lists in stamps
    expect(p4[0].giftIds).toEqual(["99"]);
    // Disabled campaign: in the coverage index, but never stamped.
    const dRows = db.giftCoverage.filter((x) => x.campaignId === "D" && x.role === "trigger");
    expect(dRows.length).toBe(5);
    const via = db.giftCoverage.find((x) => x.campaignId === "C" && x.productId === P(1));
    expect(JSON.parse(via!.viaJson)).toEqual(["Collection: Lenses"]);
  });

  it("writes only changed products on the next run", async () => {
    await syncAll(admin, "s");
    writes = [];
    const r = await syncAll(admin, "s");
    expect(r.changed).toBe(0);
    expect(writes).toEqual([]);
  });

  it("clears a product that dropped out of a rule", async () => {
    await syncAll(admin, "s");
    products.find((p) => p.id === P(3))!.vendor = "Someone else";
    writes = [];
    await syncAll(admin, "s");
    expect(writes).toEqual([P(3)]);
    expect(ids(P(3))).toEqual([]);
  });

  it("single-product sync follows a tag change and ignores no-op echoes", async () => {
    await syncAll(admin, "s");
    products.find((p) => p.id === P(1))!.tags = [];
    writes = [];
    const r = await syncProduct(admin, "s", P(1));
    expect(r.changed).toBe(1);
    expect(ids(P(1))).toEqual(["B", "C"]);
    writes = [];
    const again = await syncProduct(admin, "s", P(1));
    expect(again.changed).toBe(0);
    expect(writes).toEqual([]);
    const cov = db.giftCoverage.filter((x) => x.productId === P(1) && x.role === "trigger");
    expect(cov.map((x) => x.campaignId).sort()).toEqual(["B", "C", "D"]);
  });

  it("disabling a campaign removes it from stamps", async () => {
    await syncAll(admin, "s");
    db.giftCampaign.find((c) => c.id === "B")!.enabled = false;
    await syncAll(admin, "s");
    expect(ids(P(1))).toEqual(["A", "C"]);
    expect(ids(P(3))).toEqual([]);
  });

  it("first run cleans stale stamps left by the old code", async () => {
    stamps[P(2)] = JSON.stringify([{ id: "OLD", triggers: ["1", "2"] }]);
    db.giftCoverage = [{ shop: "s", campaignId: "OLD", productId: P(2), role: "trigger" }];
    await syncAll(admin, "s");
    expect(ids(P(2))).toEqual([]);
  });
});
