// A discount on part of a line must not make Shopify split the line (user 11/11: the cart showed the main product
// twice after changing it to 2 units). run() gives the whole line the same money as a fixed amount.
import { describe, expect, it } from "vitest";
import { run, compute } from "../src/run.js";

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
let lid = 0;
const line = (o) => ({
  id: `gid://shopify/CartLine/${++lid}`, quantity: o.q || 1,
  cost: { amountPerQuantity: { amount: String(o.price) }, compareAtAmountPerQuantity: null },
  cgpGrp: o.grp ? { value: o.grp } : null, cgpFor: o.for ? { value: o.for } : null, cgpFree: null, cgpLo: null,
  cgpBid: o.bid ? { value: o.bid } : null, cgpGift: o.gift ? { value: o.gift } : null,
  merchandise: { __typename: "ProductVariant", id: V(o.v), product: { id: P(o.p), addonConfig: o.cfg ? { value: JSON.stringify(o.cfg) } : null, giftTrigger: o.trig ? { value: JSON.stringify(o.trig) } : null } },
});
const input = (lines) => ({ shop: { localTime: { date: "2026-11-11" } }, discountNode: { metafield: null, giftMeta: null }, cart: { lines } });
// money off per line: percentage × units named (or all units), or a fixed amount
const money = (res, lines) => {
  const out = {};
  for (const d of res.discounts) for (const t of d.targets) {
    const l = lines.find((x) => x.id === t.cartLine.id);
    const unit = Number(l.cost.amountPerQuantity.amount);
    const off = d.value.fixedAmount ? Number(d.value.fixedAmount.amount) : unit * (t.cartLine.quantity ?? l.quantity) * Number(d.value.percentage.value) / 100;
    out[l.id] = Math.round(((out[l.id] || 0) + off) * 100) / 100;
  }
  return out;
};
const noPartial = (res, lines) => res.discounts.every((d) => d.targets.every((t) => {
  const l = lines.find((x) => x.id === t.cartLine.id);
  return t.cartLine.quantity == null || t.cartLine.quantity >= l.quantity;
}));

describe("partial-line discounts become whole-line amounts", () => {
  it("combo deal for 1 of 2 units: same money, no split", () => {
    lid = 0;
    const deal = [{ id: "d1", kind: "deal", pct: 10, giftIds: ["2"] }];
    const lines = [line({ p: 1, v: 11, price: 229, trig: deal }), line({ p: 2, v: 21, price: 289, q: 2 })];
    const before = compute(input(lines)), after = run(input(lines));
    expect(money(after, lines)).toEqual(money(before, lines));
    expect(money(after, lines)[lines[1].id]).toBe(28.9);
    expect(noPartial(after, lines)).toBe(true);
    expect(after.discounts[0].message).toBe(before.discounts[0].message);
  });
  it("bundle with more accessories than kits: one kit's worth, accessory line not split", () => {
    lid = 0;
    const cfg = { version: 1, groups: [{ id: "b1", type: "bundle", discountPercent: 10, accessories: [{ productId: P(2) }] }] };
    const lines = [line({ p: 1, v: 11, price: 100, grp: "g", bid: "b1", cfg }), line({ p: 2, v: 21, price: 10, q: 4, grp: "g", for: "m" })];
    const before = compute(input(lines)), after = run(input(lines));
    expect(money(after, lines)).toEqual(money(before, lines));
    expect(noPartial(after, lines)).toBe(true);
  });
  it("gift above the allowance: only the allowed units free, gift line not split", () => {
    lid = 0;
    const trig = [{ id: "c1", rewardMode: "all", giftIds: ["6"], giftQty: { 6: 1 } }];
    const lines = [line({ p: 5, v: 51, price: 229, trig }), line({ p: 6, v: 61, price: 22.31, q: 3, gift: "c1" })];
    const before = compute(input(lines)), after = run(input(lines));
    expect(money(after, lines)).toEqual(money(before, lines));
    expect(money(after, lines)[lines[1].id]).toBe(22.31);
    expect(noPartial(after, lines)).toBe(true);
  });
  it("discounts on whole lines are left exactly as they were", () => {
    lid = 0;
    const deal = [{ id: "d1", kind: "deal", pct: 10, giftIds: ["2"] }];
    const lines = [line({ p: 1, v: 11, price: 229, q: 2, trig: deal }), line({ p: 2, v: 21, price: 289, q: 2 })];
    expect(run(input(lines))).toEqual(compute(input(lines)));
  });
});
