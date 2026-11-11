// Carts a customer could build by calling Shopify's cart API by hand (no product page, no cart UI): none of them may
// get more off than the shop's own offers allow. (11/10 pre-launch check of the new cart.)
import { describe, test, expect } from "vitest";
// these tests check which units get which discount (before partial lines become whole-line amounts, see wholelines.test.js)
import { compute as run } from "../src/run.js";

const P = (n) => "gid://shopify/Product/" + n, V = (n) => "gid://shopify/ProductVariant/" + n;
let lid = 0;
const line = (o) => ({ id: "gid://shopify/CartLine/" + (++lid), quantity: o.q || 1,
  cost: { amountPerQuantity: { amount: String(o.price) }, compareAtAmountPerQuantity: null },
  cgpGrp: o.grp ? { value: o.grp } : null, cgpFor: o.for ? { value: o.for } : null, cgpFree: o.free ? { value: "1" } : null,
  cgpLo: null, cgpBid: o.bid ? { value: o.bid } : null, cgpGift: o.gift ? { value: o.gift } : null,
  merchandise: { __typename: "ProductVariant", id: V(o.v), product: { id: P(o.p),
    addonConfig: o.cfg ? { value: JSON.stringify(o.cfg) } : null, giftTrigger: o.trig ? { value: JSON.stringify(o.trig) } : null } } });
// pounds taken off each line, in cart order
const off = (lines) => {
  const res = run({ shop: { localTime: { date: "2026-11-10" } }, discountNode: { metafield: null, giftMeta: null }, cart: { lines } });
  return lines.map((l) => (res.discounts || []).reduce((a, d) => a + d.targets.filter((t) => t.cartLine.id === l.id)
    .reduce((b, t) => b + Number(l.cost.amountPerQuantity.amount) * t.cartLine.quantity * Number(d.value.percentage.value) / 100, 0), 0));
};
const fresh = () => { lid = 0; };

// bundle b1: main product 1 (for variant 11 £100 only; variant 12 £900), accessory product 2 (offered variant 21 £10; 22 £500), 10%
const bundle = { version: 1, groups: [{ id: "b1", type: "bundle", discountPercent: 10, mainVariantIds: [V(11)], accessories: [{ productId: P(2), variantIds: [V(21)] }] }] };
const main = (o) => line({ p: 1, v: 11, price: 100, grp: "g", bid: "b1", cfg: bundle, ...o });
const acc = (o) => line({ p: 2, v: 21, price: 10, grp: "g", for: "m", ...o });

describe("bundles", () => {
  test("the real bundle gets its %", () => { fresh(); expect(off([main(), acc()])).toEqual([10, 1]); });
  test("more accessories than kits: only one kit discounted", () => { fresh(); expect(off([main(), acc({ q: 5 })])).toEqual([10, 1]); });
  test("main switched to a variant the bundle isn't for: no bundle price", () => { fresh(); expect(off([main({ v: 12, price: 900 }), acc()])).toEqual([0, 0]); });
  test("accessory switched to a variant that isn't offered: no bundle price", () => { fresh(); expect(off([main(), acc({ v: 22, price: 500 })])).toEqual([0, 0]); });
  test("a hidden bundle (still being edited) gives nothing", () => {
    fresh();
    const hidden = { version: 1, groups: [{ id: "b1", type: "bundle", discountPercent: 50, hidden: true, accessories: [{ productId: P(2) }] }] };
    expect(off([main({ cfg: hidden }), acc()])).toEqual([0, 0]);
  });
  test("an extra plain main doesn't add kits", () => { fresh(); expect(off([main(), line({ p: 1, v: 11, price: 100, cfg: bundle }), acc({ q: 2 })])).toEqual([10, 0, 1]); });
});

describe("add-ons and free items", () => {
  const addon = { version: 1, groups: [{ id: "a1", type: "addon", discountPercent: 20, mainVariantIds: [V(11)], accessories: [{ productId: P(3), variantIds: [V(31)] }] }] };
  test("add-on switched to a variant that isn't offered: full price", () => { fresh(); expect(off([line({ p: 1, v: 11, price: 100, cfg: addon }), line({ p: 3, v: 32, price: 800, for: "m" })])).toEqual([0, 0]); });
  test("one add-on unit per main", () => { fresh(); expect(off([line({ p: 1, v: 11, price: 100, cfg: addon }), line({ p: 3, v: 31, price: 50, q: 5, for: "m" })])).toEqual([0, 10]); });
  const free = { version: 1, groups: [{ id: "f1", type: "free", discountPercent: 100, mainVariantIds: [V(11)], accessories: [{ productId: P(4), variantIds: [V(41)] }] }] };
  test("free item with a main variant that doesn't come with it: full price", () => { fresh(); expect(off([line({ p: 1, v: 12, price: 900, cfg: free }), line({ p: 4, v: 41, price: 30, free: 1 })])).toEqual([0, 0]); });
  test("free item switched to a pricier variant: full price", () => { fresh(); expect(off([line({ p: 1, v: 11, price: 100, cfg: free }), line({ p: 4, v: 42, price: 300, free: 1 })])).toEqual([0, 0]); });
  test("the offered free item is free", () => { fresh(); expect(off([line({ p: 1, v: 11, price: 100, cfg: free }), line({ p: 4, v: 41, price: 30, free: 1 })])).toEqual([0, 30]); });
});

describe("gift campaigns and deals", () => {
  const trig = [{ id: "c1", giftIds: ["6"], giftVariants: { 6: ["61"] }, startDate: "2026-11-01", endDate: "2026-11-30" }];
  test("a gift without its product: full price", () => { fresh(); expect(off([line({ p: 6, v: 61, price: 25, gift: "c1" })])).toEqual([0]); });
  test("three gifts for one product: one free", () => { fresh(); expect(off([line({ p: 5, v: 51, price: 200, trig }), line({ p: 6, v: 61, price: 25, q: 3, gift: "c1" })])).toEqual([0, 25]); });
  test("gift switched to a variant that isn't offered: full price", () => { fresh(); expect(off([line({ p: 5, v: 51, price: 200, trig }), line({ p: 6, v: 62, price: 250, gift: "c1" })])).toEqual([0, 0]); });
  test("ended campaign: full price", () => { fresh(); expect(off([line({ p: 5, v: 51, price: 200, trig: [{ ...trig[0], endDate: "2026-11-09" }] }), line({ p: 6, v: 61, price: 25, gift: "c1" })])).toEqual([0, 0]); });
  test("a free item doesn't count as the purchase that earns a gift", () => {
    fresh();
    const cfg = { version: 1, groups: [{ id: "f1", type: "free", discountPercent: 100, accessories: [{ productId: P(5) }] }] };
    expect(off([line({ p: 1, v: 11, price: 100, cfg }), line({ p: 5, v: 51, price: 200, free: 1, trig }), line({ p: 6, v: 61, price: 25, gift: "c1" })])).toEqual([0, 200, 0]);
  });
  test("a bundle component doesn't earn a gift", () => { fresh(); expect(off([line({ p: 5, v: 51, price: 200, for: "x", trig }), line({ p: 6, v: 61, price: 25, gift: "c1" })])).toEqual([0, 0]); });
  const deal = [{ id: "d1", kind: "deal", pct: 30, giftIds: ["8"] }];
  test("deal: one reward per trigger", () => { fresh(); expect(off([line({ p: 7, v: 71, price: 300, trig: deal }), line({ p: 8, v: 81, price: 100, q: 4 })])).toEqual([0, 30]); });
  test("deal reward alone: full price", () => { fresh(); expect(off([line({ p: 8, v: 81, price: 100 })])).toEqual([0]); });
});
