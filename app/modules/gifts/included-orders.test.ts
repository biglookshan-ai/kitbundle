import { describe, expect, it, vi } from "vitest";
import { pickVariant, planParts, type OrderLine } from "./included-orders";

vi.mock("../../db.server", () => ({ default: {} }));
vi.mock("../../shopify.server", () => ({ unauthenticated: {} }));

const entry = (over: Record<string, unknown> = {}) => ({
  id: "camp_usb",
  order: true,
  gifts: ["usb"],
  giftIds: ["99"],
  giftVariants: {},
  giftQty: { "99": 1 },
  priority: 0,
  exclusive: false,
  rewardMode: "all",
  ...over,
});

const line = (over: Partial<OrderLine> = {}): OrderLine => ({
  productTitle: "PDMOVIE SMART FUSION",
  variantTitle: "Smart Fusion",
  variantId: "gid://shopify/ProductVariant/111",
  quantity: 2,
  stamp: JSON.stringify([entry()]),
  props: {},
  ...over,
});

describe("planParts (order-only campaigns)", () => {
  it("adds line qty × gift qty", () => {
    const s = JSON.stringify([entry({ giftIds: ["99", "98"], giftQty: { "99": 1, "98": 3 } })]);
    const r = planParts([line({ stamp: s })], "2026-11-09");
    expect(r.map((p) => [p.productTail, p.quantity])).toEqual([
      ["99", 2],
      ["98", 6],
    ]);
    expect(r[0].withTitles).toEqual(["PDMOVIE SMART FUSION (Smart Fusion)"]);
  });

  it("ignores entries shown on the storefront (gift / included / deal)", () => {
    const s = JSON.stringify([
      entry({ order: undefined }),
      entry({ id: "inc", order: undefined, included: true }),
      entry({ id: "deal", kind: "deal" }),
    ]);
    expect(planParts([line({ stamp: s })], "2026-11-09")).toEqual([]);
  });

  it("respects the date window and trigger variants", () => {
    const ended = JSON.stringify([entry({ endDate: "2026-11-08" })]);
    expect(planParts([line({ stamp: ended })], "2026-11-09")).toEqual([]);
    const other = JSON.stringify([entry({ triggerVariants: ["222"] })]);
    expect(planParts([line({ stamp: other })], "2026-11-09")).toEqual([]);
    const mine = JSON.stringify([entry({ triggerVariants: ["111"] })]);
    expect(planParts([line({ stamp: mine })], "2026-11-09")[0].quantity).toBe(2);
  });

  it("skips gift and kit lines, sums the same part across lines", () => {
    const r = planParts(
      [
        line(),
        line({ variantId: "gid://shopify/ProductVariant/112", variantTitle: "Smart Fusion + Motor", quantity: 1 }),
        line({ props: { _cgp_gift: "camp_x" } }),
        line({ props: { _addon_for: "abc" } }),
      ],
      "2026-11-09",
    );
    expect(r).toHaveLength(1);
    expect(r[0].quantity).toBe(3);
    expect(r[0].withTitles).toHaveLength(2);
  });

  it("overlap: an exclusive higher-priority order campaign stands alone", () => {
    const s = JSON.stringify([
      entry({ id: "a", giftIds: ["1"], giftQty: { "1": 1 } }),
      entry({ id: "b", giftIds: ["2"], giftQty: { "2": 1 }, priority: 5, exclusive: true }),
    ]);
    expect(planParts([line({ stamp: s })], "").map((p) => p.productTail)).toEqual(["2"]);
  });
});

describe("pickVariant", () => {
  const vs = [
    { id: "gid://shopify/ProductVariant/1", availableForSale: false },
    { id: "gid://shopify/ProductVariant/2", availableForSale: true },
    { id: "gid://shopify/ProductVariant/3", availableForSale: true },
  ];
  it("prefers an allowed, in-stock variant", () => {
    expect(pickVariant(vs, [])).toBe("gid://shopify/ProductVariant/2");
    expect(pickVariant(vs, ["3"])).toBe("gid://shopify/ProductVariant/3");
    expect(pickVariant(vs, ["1"])).toBe("gid://shopify/ProductVariant/1");
    expect(pickVariant(vs, ["9"])).toBeNull();
  });
});

describe("fillOrder", () => {
  function fakeAdmin(order: any, partPrice = "0.00") {
    const calls: string[] = [];
    const admin = {
      graphql: async (q: string, opts?: { variables?: any }) => {
        const name = /(?:query|mutation)\s+(\w+)/.exec(q)?.[1] ?? "";
        calls.push(`${name} ${JSON.stringify(opts?.variables ?? {})}`);
        const data: Record<string, any> = {
          KbIncludedOrder: { shop: { ianaTimezone: "Europe/London" }, order },
          KbIncludedParts: {
            nodes: [{ id: "gid://shopify/Product/99", title: "#USB-C cable", variants: { nodes: [{ id: "gid://shopify/ProductVariant/990", availableForSale: true }] } }],
          },
          KbEditBegin: { orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/1" }, userErrors: [] } },
          KbEditAdd: {
            orderEditAddVariant: {
              calculatedLineItem: { id: "gid://shopify/CalculatedLineItem/5", originalUnitPriceSet: { shopMoney: { amount: partPrice } } },
              userErrors: [],
            },
          },
          KbEditFree: { orderEditAddLineItemDiscount: { userErrors: [] } },
          KbEditCommit: { orderEditCommit: { order: { id: order?.id }, userErrors: [] } },
        };
        return new Response(JSON.stringify({ data: data[name] }));
      },
    };
    return { admin, calls };
  }
  const orderWith = (nodes: any[], over: Record<string, unknown> = {}) => ({
    id: "gid://shopify/Order/1",
    name: "#CGP1",
    createdAt: "2026-11-09T10:00:00Z",
    cancelledAt: null,
    displayFulfillmentStatus: "UNFULFILLED",
    lineItems: { nodes },
    ...over,
  });
  const mainNode = (qty = 2) => ({
    currentQuantity: qty,
    customAttributes: [],
    variant: {
      id: "gid://shopify/ProductVariant/111",
      title: "Smart Fusion",
      product: { id: "gid://shopify/Product/7", title: "PDMOVIE SMART FUSION", metafield: { value: JSON.stringify([entry()]) } },
    },
  });

  it("adds the parts in one edit, free, without notifying", async () => {
    const { fillOrder } = await import("./included-orders.server");
    const { admin, calls } = fakeAdmin(orderWith([mainNode()]), "4.99");
    const r = await fillOrder(admin, "gid://shopify/Order/1");
    expect(r.status).toBe("added");
    expect(r.detail).toBe("2 × USB-C cable");
    expect(calls.map((c) => c.split(" ")[0])).toEqual([
      "KbIncludedOrder",
      "KbIncludedParts",
      "KbEditBegin",
      "KbEditAdd",
      "KbEditFree",
      "KbEditCommit",
    ]);
    expect(calls[3]).toContain('"quantity":2');
    expect(calls[4]).toContain('"percentValue":100');
  });

  it("£0 parts need no discount", async () => {
    const { fillOrder } = await import("./included-orders.server");
    const { admin, calls } = fakeAdmin(orderWith([mainNode()]), "0.00");
    await fillOrder(admin, "gid://shopify/Order/1");
    expect(calls.some((c) => c.startsWith("KbEditFree"))).toBe(false);
  });

  it("doesn't add twice: parts already on the order count", async () => {
    const { fillOrder } = await import("./included-orders.server");
    const usb = { currentQuantity: 2, customAttributes: [], variant: { id: "gid://shopify/ProductVariant/990", title: "Default Title", product: { id: "gid://shopify/Product/99", title: "#USB", metafield: null } } };
    const { admin, calls } = fakeAdmin(orderWith([mainNode(), usb]));
    const r = await fillOrder(admin, "gid://shopify/Order/1");
    expect(r.detail).toBe("Already on the order");
    expect(calls).toHaveLength(1);
  });

  it("leaves cancelled / fulfilled orders, and orders without parts", async () => {
    const { fillOrder } = await import("./included-orders.server");
    expect((await fillOrder(fakeAdmin(orderWith([mainNode()], { cancelledAt: "x" })).admin, "o")).status).toBe("skipped");
    expect((await fillOrder(fakeAdmin(orderWith([mainNode()], { displayFulfillmentStatus: "FULFILLED" })).admin, "o")).status).toBe("skipped");
    const plain = { ...mainNode(), variant: { ...mainNode().variant, product: { id: "p", title: "x", metafield: null } } };
    expect((await fillOrder(fakeAdmin(orderWith([plain])).admin, "o")).status).toBe("none");
  });
});
