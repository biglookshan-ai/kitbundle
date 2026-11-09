// @ts-check

/**
 * Gift guard (cart & checkout validation).
 *
 * Products marked "not sold separately" (`custom.kb_gift_only`, written by the
 * KitBundle sync for gift campaigns with that option) are usually £0 parts that
 * only come with a qualifying product. The discount Function can't protect a
 * £0 item (there's nothing to discount), so this rule blocks checkout when the
 * cart holds more of such a product than its qualifying items allow:
 *
 *   allowed(product) = Σ over qualifying lines of (line qty × that gift's qty)
 *
 * using the same campaign rules as the discount Function: the campaign must be
 * live today (store-local date window), the trigger variant must be allowed,
 * and overlapping campaigns are resolved by priority / exclusive.
 *
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

/** Numeric tail of a gid. */
function gidTail(id) {
  return String(id ?? "").split("/").pop();
}

/** Inside the campaign's store-local date window today? (Same as the discount.) */
function campaignDateOk(e, today) {
  if (!today) return true;
  const start =
    (typeof e.startDate === "string" && e.startDate) ||
    (typeof e.startsAt === "string" ? e.startsAt.slice(0, 10) : "");
  const end =
    (typeof e.endDate === "string" && e.endDate) ||
    (typeof e.endsAt === "string" ? e.endsAt.slice(0, 10) : "");
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/** Campaigns given on one product: priority first; an exclusive top stands alone. */
function overlapWinners(list) {
  if (list.length <= 1) return list;
  const sorted = list
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        (Number(b.c.priority) || 0) - (Number(a.c.priority) || 0) || a.i - b.i,
    )
    .map((x) => x.c);
  if (sorted[0].exclusive) return [sorted[0]];
  return sorted.filter((c) => !c.exclusive);
}

/** Units of one gift per qualifying unit (per-gift qty; older stamps: q). */
function giftQtyOf(e, tail) {
  const per = e && e.giftQty && Number(e.giftQty[tail]);
  if (per >= 1) return Math.floor(per);
  const q = Number(e && e.qtyPerGift) || (e && e.rewardMode === "all" ? 1 : Number(e && e.perQualifying)) || 1;
  return Math.max(1, Math.floor(q));
}

/**
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const lines = input?.cart?.lines ?? [];
  const today = input?.shop?.localTime?.date ?? "";

  // Gift-only products in the cart: tail → { units, title, with }.
  /** @type {Map<string, {units: number, title: string, with: string}>} */
  const giftOnly = new Map();
  for (const line of lines) {
    const product = /** @type {any} */ (line?.merchandise)?.product;
    const raw = product?.giftOnly?.value;
    if (!raw) continue;
    let info = {};
    try {
      info = JSON.parse(raw) || {};
    } catch {
      info = {};
    }
    const tail = gidTail(product.id);
    const cur = giftOnly.get(tail) ?? {
      units: 0,
      // Internal parts are often named "#…"; shoppers shouldn't see the "#".
      title: String(product.title || "This item").replace(/^[#\s]+/, "") || "This item",
      with: String(/** @type {any} */ (info).with || "a qualifying product"),
    };
    cur.units += Number(line?.quantity) || 0;
    giftOnly.set(tail, cur);
  }
  if (!giftOnly.size) return { operations: [{ validationAdd: { errors: [] } }] };

  // How many of each gift-only product the qualifying lines allow.
  /** @type {Map<string, number>} */
  const allowed = new Map();
  for (const line of lines) {
    if (/** @type {any} */ (line)?.cgpGift?.value) continue; // a gift isn't a trigger
    if (/** @type {any} */ (line)?.cgpFor?.value) continue; // a kit component isn't a unit
    const product = /** @type {any} */ (line?.merchandise)?.product;
    const raw = product?.giftTrigger?.value;
    if (!raw) continue;
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    const vid = gidTail(/** @type {any} */ (line?.merchandise)?.id);
    const valid = entries.filter(
      (e) =>
        e &&
        e.id &&
        e.kind !== "deal" &&
        !e.order && // order-only parts are added after checkout, never bought
        campaignDateOk(e, today) &&
        !(
          Array.isArray(e.triggerVariants) &&
          e.triggerVariants.length &&
          !e.triggerVariants.map(String).includes(vid)
        ),
    );
    const qty = Number(line?.quantity) || 0;
    for (const e of overlapWinners(valid)) {
      for (const t of (Array.isArray(e.giftIds) ? e.giftIds : []).map(String)) {
        if (!giftOnly.has(t)) continue;
        allowed.set(t, (allowed.get(t) ?? 0) + qty * giftQtyOf(e, t));
      }
    }
  }

  const errors = [];
  for (const [tail, g] of giftOnly) {
    const ok = allowed.get(tail) ?? 0;
    if (g.units <= ok) continue;
    errors.push({
      message:
        ok === 0
          ? `${g.title} is only available with ${g.with}. Please remove it to continue.`
          : `Only ${ok} × ${g.title} can come with the items in your cart. Please reduce it to ${ok}.`,
      target: "$.cart",
    });
  }
  return { operations: [{ validationAdd: { errors } }] };
}
