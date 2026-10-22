// Add-on deals (2026-10-22, Smart Fusion × compatible lenses): buy a trigger
// product → ONE reward unit per trigger unit gets pct% off, recognised by
// product id however the reward was added (no `_cgp_gift` needed).
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
let lid = 0;
const reset = () => (lid = 0);
const DEAL = { id: "d1", kind: "deal", pct: 10, giftIds: ["11", "12", "13"], rewardMode: "all" };
const lens = (qty, entries = [DEAL], pid = 1) => ({
  id: `L${++lid}`,
  quantity: qty,
  cost: { amountPerQuantity: { amount: "1500" } },
  merchandise: { __typename: "ProductVariant", id: V(pid), product: { id: P(pid), giftTrigger: { value: JSON.stringify(entries) } } },
});
const item = (pid, qty, price, extra = {}) => ({
  id: `L${++lid}`,
  quantity: qty,
  cost: { amountPerQuantity: { amount: String(price) } },
  merchandise: { __typename: "ProductVariant", id: V(pid * 10), product: { id: P(pid) } },
  ...extra,
});
const out = (lines, date = "2026-10-22") =>
  run({ shop: { localTime: { date } }, discountNode: { metafield: null, giftMeta: null }, cart: { lines } }).discounts;
const deals = (lines, date) =>
  Object.fromEntries(
    out(lines, date)
      .filter((d) => /^Bundle offer/.test(d.message))
      .map((d) => [d.targets[0].cartLine.id, [d.targets[0].cartLine.quantity, d.value.percentage.value]]),
  );

describe("add-on deals", () => {
  it("a reward added from its own page (no property) gets the deal", () => {
    reset();
    expect(deals([lens(1), item(11, 1, 600)])).toEqual({ L2: [1, "10.0"] });
  });
  it("no trigger in the cart → full price", () => {
    reset();
    expect(deals([item(11, 1, 600)])).toEqual({});
  });
  it("one discounted unit per lens, most expensive reward first", () => {
    reset();
    // 1 lens: only the £900 kit gets 10%; 2 lenses: kit + one Fusion
    expect(deals([lens(1), item(11, 2, 600), item(12, 1, 900)])).toEqual({ L3: [1, "10.0"] });
    reset();
    expect(deals([lens(2), item(11, 2, 600), item(12, 1, 900)])).toEqual({ L3: [1, "10.0"], L2: [1, "10.0"] });
  });
  it("products that aren't rewards stay full price", () => {
    reset();
    expect(deals([lens(1), item(99, 1, 600)])).toEqual({});
  });
  it("a reward added by the deal picker (_cgp_gift = deal id) also counts", () => {
    reset();
    expect(deals([lens(1), item(13, 1, 600, { cgpGift: { value: "d1" } })])).toEqual({ L2: [1, "10.0"] });
  });
  it("bundle / add-on parts keep their own pricing", () => {
    reset();
    expect(deals([lens(1), item(11, 1, 600, { cgpFor: { value: "x" } })])).toEqual({});
  });
  it("outside the dates → no deal", () => {
    reset();
    const ended = { ...DEAL, endDate: "2026-10-01" };
    expect(deals([lens(1, [ended]), item(11, 1, 600)])).toEqual({});
  });
  it("variant restriction is enforced", () => {
    reset();
    const only = { ...DEAL, giftVariants: { 11: ["999"] } };
    expect(deals([lens(1, [only]), item(11, 1, 600)])).toEqual({}); // variant 110 isn't offered
  });
  it("gift campaigns on the same product still work alongside a deal", () => {
    reset();
    const gift = { id: "g1", rewardMode: "all", qtyPerGift: 1, giftIds: ["50"] };
    const d = out([lens(1, [DEAL, gift]), item(11, 1, 600), item(50, 1, 20, { cgpGift: { value: "g1" } })]);
    expect(d.find((x) => x.message === "FREE GIFT")?.targets[0].cartLine.id).toBe("L3");
    expect(d.find((x) => /^Bundle offer/.test(x.message))?.targets[0].cartLine.id).toBe("L2");
  });
});
