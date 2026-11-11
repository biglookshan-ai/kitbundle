// Simulation of the site-wide cart guard (assets/cart-guard.js) with a fake Shopify cart, for the 2026-11-10 change:
// a main product added outside its product page (collection / search cards) gets the product page's default free
// gifts; a gift the customer deletes isn't added again; the product's own page (KitBundle block) is left alone.
//   node tests/cart-guard-gifts.sim.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../extensions/addon-block/assets/cart-guard.js"), "utf8");

// ---- catalogue: LIVE AIR 4 (campaign "all": gear ring + rod ring, rod ring only variant 611),
// Smart Fusion (campaign "choice" 1 of 2: first gift sold out → second), a lens with no campaign ----
const products = {
  "live-air-4": { id: 1, variants: [{ id: 101, available: true }, { id: 102, available: true }] },
  "gear-ring": { id: 5, variants: [{ id: 501, available: true }] },
  "rod-ring": { id: 6, variants: [{ id: 610, available: true }, { id: 611, available: true }] },
  "smart-fusion": { id: 2, variants: [{ id: 201, available: true }] },
  "sold-out-gift": { id: 7, variants: [{ id: 701, available: false }] },
  "lens": { id: 3, variants: [{ id: 301, available: true }] },
  "fusion-solo": { id: 8, variants: [{ id: 801, available: true }] },
  "upgrader": { id: 9, variants: [{ id: 901, available: true }] },
};
const stampsOf = {
  "live-air-4": [{ id: "camp_all", rewardMode: "all", gifts: ["gear-ring", "rod-ring"], giftIds: ["5", "6"], giftVariants: { 6: ["611"] }, giftQty: { 5: 1, 6: 1 }, triggerVariants: ["101"], endsLabel: "30 Nov" }],
  "smart-fusion": [{ id: "camp_pick", rewardMode: "choice", chooseCount: 1, gifts: ["sold-out-gift", "gear-ring"], giftIds: ["7", "5"], giftQty: { 7: 1, 5: 1 } }],
  "lens": [],
  "fusion-solo": [{ id: "camp_inc", included: true, rewardMode: "all", gifts: ["upgrader"], giftIds: ["9"], giftQty: { 9: 1 } }],
};
const byVariant = {};
for (const [handle, p] of Object.entries(products)) for (const v of p.variants) byVariant[v.id] = { handle, product_id: p.id };

// ---- fake cart server ----
let cart = [];
let keyN = 0;
const cartJson = () => ({ items: cart.map((l) => ({ ...l })), item_count: cart.reduce((a, l) => a + l.quantity, 0) });
const res = (obj, ok = true) => ({ ok, status: ok ? 200 : 422, json: async () => obj, text: async () => JSON.stringify(obj), clone() { return res(obj, ok); } });
function addLine(id, quantity, properties = {}) {
  const v = byVariant[id];
  const same = cart.find((l) => l.variant_id === id && JSON.stringify(l.properties) === JSON.stringify(properties));
  if (same) same.quantity += quantity;
  else cart.push({ key: `${id}:k${++keyN}`, variant_id: id, product_id: v.product_id, handle: v.handle, quantity, properties, product_title: v.handle.toUpperCase(), variant_title: "Default Title" });
}
function readBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  // FormData-like
  const o = { properties: {} };
  body.forEach((val, k) => { const m = /^properties\[(.+)\]$/.exec(k); if (m) o.properties[m[1]] = val; else o[k] = val; });
  return o;
}
async function server(url, init = {}) {
  const u = new URL(url, "https://shop.test");
  const p = u.pathname;
  if (p === "/cart.js") return res(cartJson());
  if (p === "/cart/add.js") {
    const b = readBody(init.body);
    for (const it of b.items || [b]) addLine(Number(it.id), Number(it.quantity) || 1, it.properties || {});
    return res({ items: [] });
  }
  if (p === "/cart/change.js") {
    const b = readBody(init.body);
    const l = b.line ? cart[Number(b.line) - 1] : cart.find((x) => x.key === b.id);
    if (l) l.quantity = Number(b.quantity);
    cart = cart.filter((x) => x.quantity > 0);
    return res(cartJson());
  }
  if (p === "/cart/update.js") {
    const b = readBody(init.body);
    for (const [k, q] of Object.entries(b.updates || {})) { const l = cart.find((x) => x.key === k); if (l) l.quantity = Number(q); }
    cart = cart.filter((x) => x.quantity > 0);
    return res(cartJson());
  }
  let m = /^\/products\/([^/.]+)\.js$/.exec(p);
  if (m) return res(products[m[1]]);
  m = /^\/products\/([^/.]+)$/.exec(p);
  if (m) {
    const html = `<html><script type="application/json" data-cgp-gifts>${JSON.stringify(stampsOf[m[1]] || [])}</script></html>`;
    return { ok: true, text: async () => html, json: async () => ({}) };
  }
  return res({}, false);
}

// ---- fake page ----
function page({ ownProduct = null } = {}) {
  const store = new Map();
  const win = {
    fetch: server,
    ShopifyAnalytics: ownProduct ? { meta: { product: { variants: products[ownProduct].variants } } } : undefined,
    addEventListener() {},
    location: { pathname: ownProduct ? `/products/${ownProduct}` : "/collections/all", reload() {} },
  };
  const doc = {
    readyState: "complete",
    querySelector: (sel) => (sel === "script[data-cgp-gifts]" && ownProduct ? { textContent: "[]" } : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    documentElement: {},
    head: { appendChild() {} },
    createElement: () => ({ classList: { add() {} }, appendChild() {} }),
  };
  const ss = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  class MO { observe() {} takeRecords() {} }
  const run = new Function("window", "document", "sessionStorage", "MutationObserver", "DOMParser", "location", "ShopifyAnalytics", SRC);
  run(win, doc, ss, MO, class {}, win.location, win.ShopifyAnalytics);
  return win;
}
const settle = () => new Promise((r) => setTimeout(r, 700));
const view = () => cart.map((l) => `${l.handle}:${l.variant_id} x${l.quantity}${l.properties._cgp_gift ? ` [gift ${l.properties._cgp_gift} for ${l.properties._cgp_main} per ${l.properties._cgp_per}]` : ""}`).join(" | ");
const qty = (vid, camp) => cart.filter((l) => l.variant_id === vid && (!camp || l.properties._cgp_gift === camp)).reduce((a, l) => a + l.quantity, 0);
const json = (o) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

const results = [];
async function test(name, fn) {
  cart = [];
  try { await fn(); results.push(`ok   ${name}`); } catch (e) { results.push(`FAIL ${name}\n     ${e.message}\n     cart: ${view()}`); }
}

await test("collection card adds LIVE AIR 4 → both default gifts, rod ring in its offered variant", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] }));
  await settle();
  assert.equal(qty(501, "camp_all"), 1); assert.equal(qty(611, "camp_all"), 1); assert.equal(qty(610), 0);
  const g = cart.find((l) => l.variant_id === 611);
  assert.equal(g.properties._cgp_main, "101"); assert.equal(g.properties["Free gift"], "with LIVE-AIR-4"); assert.equal(g.properties["Free until"], "30 Nov");
});
await test("second card add of the same product → one more set (2 each)", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  await w.fetch("/cart/add.js", json({ id: 101, quantity: 1 })); await settle();
  assert.equal(qty(101), 2); assert.equal(qty(501, "camp_all"), 2); assert.equal(qty(611, "camp_all"), 2);
});
await test("form-data add (theme quick add) with quantity 2 → 2 of each gift", async () => {
  const w = page();
  const fd = new URLSearchParams({ id: "101", quantity: "2" });
  await w.fetch("/cart/add.js", { method: "POST", body: fd }); await settle();
  assert.equal(qty(501, "camp_all"), 2); assert.equal(qty(611, "camp_all"), 2);
});
await test("customer deletes a gift → it is not added back on the next card add", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  const rod = cart.find((l) => l.variant_id === 611);
  await w.fetch("/cart/change.js", json({ id: rod.key, quantity: 0 })); await settle();
  assert.equal(qty(611), 0);
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  assert.equal(qty(611), 0, "rod ring came back"); assert.equal(qty(501, "camp_all"), 1, "campaign declined: no top-up either");
});
await test("variant that doesn't trigger the campaign (102) → no gifts", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 102, quantity: 1 }] })); await settle();
  assert.equal(cart.length, 1);
});
await test("pick-1 campaign with the first gift sold out → the next gift in stock", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 201, quantity: 1 }] })); await settle();
  assert.equal(qty(701), 0); assert.equal(qty(501, "camp_pick"), 1);
});
await test("product with no campaign → nothing added", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 301, quantity: 1 }] })); await settle();
  assert.equal(cart.length, 1);
});
await test("its own product page ('No thanks') → the guard adds nothing", async () => {
  const w = page({ ownProduct: "live-air-4" });
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  assert.equal(cart.length, 1);
});
await test("product page add that brings its own gift picks → no extra gifts", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }, { id: 501, quantity: 1, properties: { _cgp_gift: "camp_all", _cgp_main: "101", _cgp_per: "1" } }] })); await settle();
  assert.equal(qty(501), 1); assert.equal(qty(611), 0);
});
await test("removing the main still removes its gifts", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  const main = cart.find((l) => l.variant_id === 101);
  await w.fetch("/cart/change.js", json({ id: main.key, quantity: 0 })); await settle();
  assert.equal(cart.length, 0);
});

await test("included part (existing behaviour) still added and follows the main", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 801, quantity: 2 }] })); await settle();
  assert.equal(qty(901, "camp_inc"), 2);
  assert.equal(cart.find((l) => l.variant_id === 901).properties._cgp_inc, "1");
});

await test("cart quantity of the main 1 → 2 → 1: its gifts follow (2, then 1)", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  let main = cart.find((l) => l.variant_id === 101);
  await w.fetch("/cart/change.js", json({ id: main.key, quantity: 2 })); await settle();
  assert.equal(qty(101), 2); assert.equal(qty(501, "camp_all"), 2); assert.equal(qty(611, "camp_all"), 2);
  main = cart.find((l) => l.variant_id === 101);
  await w.fetch("/cart/change.js", json({ id: main.key, quantity: 1 })); await settle();
  assert.equal(qty(501, "camp_all"), 1); assert.equal(qty(611, "camp_all"), 1);
});
await test("a deleted gift doesn't come back when the main's quantity goes up", async () => {
  const w = page();
  await w.fetch("/cart/add.js", json({ items: [{ id: 101, quantity: 1 }] })); await settle();
  const rod = cart.find((l) => l.variant_id === 611);
  await w.fetch("/cart/change.js", json({ id: rod.key, quantity: 0 })); await settle();
  const main = cart.find((l) => l.variant_id === 101);
  await w.fetch("/cart/change.js", json({ id: main.key, quantity: 3 })); await settle();
  assert.equal(qty(611), 0); assert.equal(qty(501, "camp_all"), 3);
});

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
