// Live check for the 2026-11-10 abuse fix (kitbundle-126). Paste into the browser console on any cinegearpro.co.uk
// page. It uses a fresh iframe's fetch so KitBundle's cart guard (which wraps window.fetch) can't tidy the cart first:
// this is what a customer calling the cart API directly gets. Requests are spaced to stay under Cloudflare's limit.
// The cart is cleared at the end.
(async () => {
  const fr = document.createElement("iframe");
  fr.style.display = "none";
  document.body.appendChild(fr);
  const nf = fr.contentWindow.fetch.bind(fr.contentWindow);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const json = { "Content-Type": "application/json" };

  // Thunderbolt 5 cable bundle PK0003 (group g_xlxm2rax, 10%)
  const G = { _cgp_grp: "check", _cgp_bid: "g_xlxm2rax", _cgp_kit: "Thunder 5 Kit 2 · PK0003" };
  const MAIN_OK = 56273805967738, MAIN_BAD = 56252791587194, ACC_OK = 56252748038522, ACC_BAD = 56252747972986;
  const acc = (id, q) => ({ id, quantity: q || 1, properties: { ...G, _addon_for: "thunderbolt-5-cable-colourflex-series" } });
  // LIVE AIR 4 gifts (camp_d8jyybmq) and Smart Fusion + Motor kit gifts (camp_dieju9hy)
  const LA4 = 55581904142714, GEAR = 32556095209551, ROD = 57096052703610;
  const FUSION = 57102666236282, FUSION_KIT = 57102666269050;
  const gift = (id, main, camp) => ({ id, quantity: 1, properties: { _cgp_gift: camp, _cgp_main: String(main), _cgp_per: "1" } });

  const cases = [
    ["A bundle legit (expect 10% on both)", [{ id: MAIN_OK, quantity: 1, properties: G }, acc(ACC_OK)]],
    ["B main off-list variant (expect full price)", [{ id: MAIN_BAD, quantity: 1, properties: G }, acc(ACC_OK)]],
    ["C accessory off-list variant (expect full price)", [{ id: MAIN_OK, quantity: 1, properties: G }, acc(ACC_BAD)]],
    ["D accessory x4 (expect 1 discounted)", [{ id: MAIN_OK, quantity: 1, properties: G }, acc(ACC_OK, 4)]],
    ["E accessory without main (expect full price)", [acc(ACC_OK)]],
    ["F LIVE AIR 4 + 2 gifts (expect gifts free)", [{ id: LA4, quantity: 1 }, gift(GEAR, LA4, "camp_d8jyybmq"), gift(ROD, LA4, "camp_d8jyybmq")]],
    ["G Fusion + Motor kit + 2 gifts (expect gifts free)", [{ id: FUSION_KIT, quantity: 1 }, gift(GEAR, FUSION_KIT, "camp_dieju9hy"), gift(ROD, FUSION_KIT, "camp_dieju9hy")]],
    ["H single Fusion + kit gifts (expect full price)", [{ id: FUSION, quantity: 1 }, gift(GEAR, FUSION, "camp_dieju9hy"), gift(ROD, FUSION, "camp_dieju9hy")]],
  ];
  const out = [];
  for (const [label, items] of cases) {
    await nf("/cart/clear.js", { method: "POST" });
    await wait(1500);
    const r = await nf("/cart/add.js", { method: "POST", headers: json, body: JSON.stringify({ items }) });
    await wait(2000);
    const c = await (await nf("/cart.js")).json();
    out.push(label + (r.ok ? "" : " ADD-FAILED " + r.status) + "\n   " +
      c.items.map((i) => `${i.product_title.slice(0, 18)} (${String(i.variant_id).slice(-5)}) x${i.quantity} £${i.original_line_price / 100} → £${i.final_line_price / 100}`).join(" | "));
  }
  await nf("/cart/clear.js", { method: "POST" });
  console.log(out.join("\n"));
  window.__kbLiveCheck = out;
})();
