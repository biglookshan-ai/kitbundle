/**
 * Gift sync engine — end to end against an in-memory store + fake Admin API.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------- in-memory prisma ---------------- */
type Row = Record<string, any>;
vi.mock("../../db.server", async () => ({
  default: (await import("./__test__/memory-db")).prismaMock,
}));
vi.mock("../../shopify.server", () => ({ unauthenticated: { admin: vi.fn() } }));

import { previewCoverage, syncAll, syncProduct } from "./engine.server";
import { db } from "./__test__/memory-db";
import { schedulerTick } from "./scheduler.server";
import { unauthenticated } from "../../shopify.server";
import { rowToCampaign } from "../../models/gift-campaign";

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
  draft: false,
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
  excludeCollectionsJson: "[]",
  excludeVendorsJson: "[]",
  excludeTypesJson: "[]",
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

  it("previews an unsaved campaign against its saved coverage, read-only", async () => {
    await syncAll(admin, "s");
    writes = [];
    // Edit campaign B (brand DZOFILM → P1, P3) to brand Tilta (→ P2) without saving.
    const edited = { ...rowToCampaign(db.giftCampaign.find((c) => c.id === "B")!), triggerVendors: ["Tilta"] };
    const p = await previewCoverage(admin, "s", edited);
    expect(p.total).toBe(1);
    expect(p.products[0].productId).toBe(P(2));
    expect(p.products[0].isNew).toBe(true);
    expect(p.products[0].via).toEqual(["Brand: Tilta"]);
    expect(p.added).toBe(1);
    expect(p.removed).toBe(2);
    expect(writes).toEqual([]); // nothing written
  });

  it("only campaigns live now are stamped (scheduled, ended, paused, draft are not)", async () => {
    const day = 86_400_000;
    const B = db.giftCampaign.find((c) => c.id === "B")!;
    B.startsAt = new Date(Date.now() + day); // scheduled
    const A = db.giftCampaign.find((c) => c.id === "A")!;
    A.endsAt = new Date(Date.now() - day); // ended
    const C = db.giftCampaign.find((c) => c.id === "C")!;
    C.draft = true;
    await syncAll(admin, "s");
    expect(ids(P(1))).toEqual([]);
    expect(ids(P(3))).toEqual([]);
    expect(stamps[P(4)]).toBeUndefined();
  });

  it("scheduler: first tick syncs, idle ticks do nothing, a passed start re-syncs", async () => {
    vi.mocked(unauthenticated.admin).mockResolvedValue({ admin } as any);
    db.session = [{ shop: "s", isOnline: false }];
    const t0 = Date.now();
    const B = db.giftCampaign.find((c) => c.id === "B")!;
    B.startsAt = new Date(t0 + 5 * 60_000); // starts in 5 minutes
    await schedulerTick(new Date(t0));
    expect(ids(P(3))).toEqual([]); // not started yet
    expect(db.giftSchedulerState[0].lastResult).toMatch(/updated/);

    writes = [];
    await schedulerTick(new Date(t0 + 60_000)); // nothing crossed
    expect(writes).toEqual([]);
    expect(db.giftSchedulerState[0].lastResult).toBe("nothing due");

    // 10 minutes later the start has passed → B appears on its products.
    vi.useFakeTimers({ now: t0 + 10 * 60_000, toFake: ["Date"] });
    try {
      await schedulerTick(new Date(t0 + 10 * 60_000));
    } finally {
      vi.useRealTimers();
    }
    expect(ids(P(3))).toEqual(["B"]);
    expect(db.giftSchedulerState[0].lockedUntil).toBeNull();
  });

  it("scheduler skips stores that uninstalled the app", async () => {
    db.session = [];
    await schedulerTick(new Date());
    expect(db.giftSchedulerState[0].lastResult).toBe("skipped: app not installed");
    expect(writes).toEqual([]);
  });

  it("excludes by collection, brand and type — full sync and webhook agree", async () => {
    db.giftCampaign = [
      campaign("X", {
        allProducts: true,
        excludeCollectionsJson: JSON.stringify([{ id: C1, title: "Lenses", handle: "lenses" }]),
        excludeVendorsJson: '["other"]',
        excludeTypesJson: '["gift"]',
      }),
    ];
    await syncAll(admin, "s");
    // P1, P2 in C1 (excluded); P4 brand Other; P99 type Gift → only P3 left.
    expect(ids(P(1))).toEqual([]);
    expect(ids(P(3))).toEqual(["X"]);
    expect(stamps[P(4)]).toBeUndefined();
    expect(stamps[P(99)]).toBeUndefined();
    // Webhook path on P1: still excluded via its collection.
    const r = await syncProduct(admin, "s", P(1));
    expect(r.changed).toBe(0);
  });
});
