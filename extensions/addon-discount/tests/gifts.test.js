// Gift campaign rules in the discount Function: pick k of N, q of each per
// qualifying unit, cheapest k win, legacy stamps keep their old behaviour.
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
let lid = 0;
const main = (qty, entries) => ({
  id: `L${++lid}`,
  quantity: qty,
  cost: { amountPerQuantity: { amount: "1000" } },
  merchandise: {
    __typename: "ProductVariant",
    id: V(1),
    product: { id: P(1), giftTrigger: { value: JSON.stringify(entries) } },
  },
});
const gift = (pid, qty, price, camp = "c1") => ({
  id: `L${++lid}`,
  quantity: qty,
  cost: { amountPerQuantity: { amount: String(price) } },
  cgpGift: { value: camp },
  merchandise: { __typename: "ProductVariant", id: V(pid * 10), product: { id: P(pid) } },
});
const freeOf = (lines) => {
  const out = run({
    shop: { localTime: { date: "2026-09-30" } },
    discountNode: { metafield: null, giftMeta: null },
    cart: { lines },
  });
  return Object.fromEntries(
    out.discounts
      .filter((d) => d.message === "FREE GIFT")
      .map((d) => [d.targets[0].cartLine.id, d.targets[0].cartLine.quantity]),
  );
};
const gifts = ["11", "12", "13"];
const reset = () => (lid = 0);

describe("gift rules", () => {
  it("choice k=2 frees the cheapest two gift products", () => {
    reset();
    const lines = [
      main(1, [{ id: "c1", rewardMode: "choice", chooseCount: 2, qtyPerGift: 1, giftIds: gifts }]),
      gift(11, 1, 50),
      gift(12, 1, 10),
      gift(13, 1, 30),
    ];
    expect(freeOf(lines)).toEqual({ L3: 1, L4: 1 });
  });
  it("q=2 with 2 mains caps each gift at 4", () => {
    reset();
    const lines = [
      main(2, [{ id: "c1", rewardMode: "choice", chooseCount: 1, qtyPerGift: 2, giftIds: gifts }]),
      gift(11, 5, 50),
    ];
    expect(freeOf(lines)).toEqual({ L2: 4 });
  });
  it("legacy all stamp: one of each gift, perQualifying ignored", () => {
    reset();
    const lines = [
      main(1, [{ id: "c1", rewardMode: "all", perQualifying: 3, giftIds: gifts }]),
      gift(11, 2, 50),
      gift(12, 1, 10),
      gift(13, 1, 30),
    ];
    expect(freeOf(lines)).toEqual({ L2: 1, L3: 1, L4: 1 });
  });
  it("legacy choice stamp: perQualifying units of one gift", () => {
    reset();
    const lines = [
      main(1, [{ id: "c1", rewardMode: "choice", perQualifying: 2, giftIds: gifts }]),
      gift(11, 2, 50),
      gift(12, 2, 10),
    ];
    expect(freeOf(lines)).toEqual({ L3: 2 });
  });
  it("fixed: a single gift product", () => {
    reset();
    const lines = [
      main(1, [{ id: "c1", rewardMode: "fixed", giftIds: gifts }]),
      gift(11, 1, 50),
      gift(12, 1, 10),
    ];
    expect(freeOf(lines)).toEqual({ L3: 1 });
  });
  it("a product outside the gift set is never free", () => {
    reset();
    expect(freeOf([main(1, [{ id: "c1", rewardMode: "all", giftIds: gifts }]), gift(99, 1, 5)])).toEqual({});
  });
  it("no trigger in the cart → nothing free", () => {
    reset();
    expect(freeOf([gift(11, 1, 50)])).toEqual({});
  });
  it("ended campaign → nothing free", () => {
    reset();
    const lines = [
      main(1, [{ id: "c1", rewardMode: "all", giftIds: gifts, endDate: "2026-09-01" }]),
      gift(11, 1, 50),
    ];
    expect(freeOf(lines)).toEqual({});
  });
});
