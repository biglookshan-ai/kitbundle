// Gift guard: a "not sold separately" (£0) gift needs enough qualifying items.
import { describe, expect, it } from "vitest";
import { cartValidationsGenerateRun as run } from "../src/cart_validations_generate_run.js";

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const camp = (extra = {}) => ({ id: "c1", rewardMode: "all", giftIds: ["99"], giftQty: { 99: 1 }, ...extra });
const main = (qty, entries, vid = 11) => ({
  quantity: qty,
  merchandise: { __typename: "ProductVariant", id: V(vid), product: { id: P(1), title: "Smart Fusion", giftTrigger: { value: JSON.stringify(entries) } } },
});
const usb = (qty, attrs = {}) => ({
  quantity: qty,
  ...attrs,
  merchandise: { __typename: "ProductVariant", id: V(990), product: { id: P(99), title: "USB Upgrader", giftOnly: { value: JSON.stringify({ with: "PDMOVIE SMART FUSION" }) } } },
});
const other = (qty) => ({ quantity: qty, merchandise: { __typename: "ProductVariant", id: V(5), product: { id: P(5), title: "Lens cap" } } });
const errorsOf = (lines, date = "2026-11-05") =>
  run({ shop: { localTime: { date } }, cart: { lines } }).operations[0].validationAdd.errors.map((e) => e.message);

describe("gift guard", () => {
  it("passes with the qualifying product", () => {
    expect(errorsOf([main(1, [camp()]), usb(1, { cgpGift: { value: "c1" } })])).toEqual([]);
  });
  it("blocks the gift on its own", () => {
    expect(errorsOf([usb(1)])).toEqual([
      "USB Upgrader is only available with PDMOVIE SMART FUSION. Please remove it to continue.",
    ]);
  });
  it("blocks more than the allowance (1 per item bought)", () => {
    expect(errorsOf([main(1, [camp()]), usb(3)])).toEqual([
      "Only 1 × USB Upgrader can come with the items in your cart. Please reduce it to 1.",
    ]);
    expect(errorsOf([main(3, [camp()]), usb(3)])).toEqual([]);
  });
  it("uses the gift's own quantity", () => {
    expect(errorsOf([main(1, [camp({ giftQty: { 99: 2 } })]), usb(2)])).toEqual([]);
  });
  it("blocks when the trigger is a variant that doesn't qualify", () => {
    expect(errorsOf([main(1, [camp({ triggerVariants: ["12"] })], 11), usb(1)]).length).toBe(1);
  });
  it("blocks once the campaign has ended", () => {
    expect(errorsOf([main(1, [camp({ endDate: "2026-11-01" })]), usb(1)]).length).toBe(1);
  });
  it("ignores carts without gift-only products", () => {
    expect(errorsOf([other(4), main(1, [camp()])])).toEqual([]);
  });
  it("a gift line can't qualify another gift", () => {
    const giftAsTrigger = { ...main(1, [camp()]), cgpGift: { value: "x" } };
    expect(errorsOf([giftAsTrigger, usb(1)]).length).toBe(1);
  });
});
