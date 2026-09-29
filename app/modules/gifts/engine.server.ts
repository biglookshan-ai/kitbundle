/**
 * Gifts module — sync engine.
 *
 * Keeps every product's `custom.gift_trigger` stamp (read by the storefront and
 * the discount Function) and the GiftCoverage index in step with the campaigns:
 *
 * - `syncAll`     — resolve every campaign's trigger set (products, collections,
 *                   tags, brands, types, all products, minus exclusions), then
 *                   write ONLY the products whose stamp changes. Products that
 *                   dropped out since the last sync (e.g. left a collection) are
 *                   found via the previous coverage and cleaned up.
 * - `syncProduct` — the same for one product, from its live data (webhooks).
 * - `queue*`      — debounced background runs for webhooks.
 *
 * Campaign rows stay the source of truth; stamps and coverage are derived.
 */
import { createHash } from "node:crypto";
import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  GIFT_TRIGGER_NAMESPACE,
  GIFT_TRIGGER_KEY,
  rowToCampaign,
  rewardRule,
  type GiftCampaign,
} from "../../models/gift-campaign";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

export function gidTail(id: string) {
  return String(id).split("/").pop() || "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GraphQL call that respects Shopify's cost-based rate limit: retries when
 * throttled and pauses when the bucket runs low, so a large sync slows down
 * instead of failing half-way.
 */
async function gql(admin: AdminGraphql, query: string, variables?: any): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    let json: any;
    try {
      const resp = await admin.graphql(query, { variables });
      json = await resp.json();
    } catch (e) {
      if (/throttl/i.test(String((e as Error)?.message ?? e))) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw e;
    }
    const throttled = (json?.errors ?? []).some(
      (e: any) => e?.extensions?.code === "THROTTLED",
    );
    if (throttled) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const ts = json?.extensions?.cost?.throttleStatus;
    if (ts && ts.currentlyAvailable < 400) {
      await sleep(((400 - ts.currentlyAvailable) / (ts.restoreRate || 50)) * 1000);
    }
    return json;
  }
  throw new Error("Shopify API is rate-limiting; try again in a minute.");
}

/* ------------------------------------------------------------------ */
/* Store time + campaign window                                        */
/* ------------------------------------------------------------------ */

/** The store's IANA timezone (e.g. "Europe/London"); "UTC" if unavailable. */
export async function shopTimezone(admin: AdminGraphql): Promise<string> {
  try {
    const json = await gql(admin, `#graphql
      query ShopTz { shop { ianaTimezone } }`);
    return json?.data?.shop?.ianaTimezone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Store-local "YYYY-MM-DD" and "HH:MM" for an instant. */
function localParts(ms: number, tz: string): { date: string; hm: string } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

/**
 * Store-local date window + a shopper-facing end label for a campaign. The
 * Function compares `startDate`/`endDate` against the store's local date, and
 * the storefront shows `endsLabel` ("12 Oct 2026" / "12 Oct 2026, 14:00"). An
 * end exactly at 00:00 means "through the previous day".
 */
function campaignWindow(
  c: { startsAt?: string; endsAt?: string },
  tz: string,
): { startDate: string; endDate: string; endsLabel: string } {
  const out = { startDate: "", endDate: "", endsLabel: "" };
  const startMs = c.startsAt ? Date.parse(c.startsAt) : NaN;
  if (!Number.isNaN(startMs)) out.startDate = localParts(startMs, tz).date;
  const endMs = c.endsAt ? Date.parse(c.endsAt) : NaN;
  if (!Number.isNaN(endMs)) {
    const hm = localParts(endMs, tz).hm;
    const dayMs = hm === "00:00" ? endMs - 1 : endMs;
    out.endDate = localParts(dayMs, tz).date;
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(dayMs));
    out.endsLabel = hm === "00:00" || hm === "23:59" ? day : `${day}, ${hm}`;
  }
  return out;
}

/**
 * The product-independent part of a campaign's stamp entry. (The old stamp
 * also carried `triggers` — every trigger product id — which nothing reads and
 * which would put thousands of ids on every product for an all-products
 * campaign; it's gone.)
 */
function campaignEntry(c: GiftCampaign, tz: string) {
  const rule = rewardRule(c);
  const giftVariants: Record<string, string[]> = {};
  for (const g of c.giftProducts) {
    const t = gidTail(g.id);
    const vs = Array.isArray(g.variantIds) ? g.variantIds.map(gidTail).filter(Boolean) : [];
    if (t && vs.length) giftVariants[t] = vs;
  }
  return {
    // Store-local window (enforced by the Function) + display label.
    ...campaignWindow(c, tz),
    id: c.id,
    gifts: c.giftProducts.map((g) => g.handle).filter(Boolean),
    // Numeric gift product ids — the discount Function matches gift lines by id.
    giftIds: c.giftProducts.map((g) => gidTail(g.id)).filter(Boolean),
    // { productIdTail: [variantIdTail] } for gifts that restrict variants.
    giftVariants,
    perQualifying: rule.q,
    // Unified reward rule: k different gifts, q of each, per qualifying unit.
    chooseCount: rule.k,
    qtyPerGift: rule.q,
    // Overlaps are resolved at checkout / on the page among campaigns live that
    // day (so a future exclusive campaign doesn't block today's).
    priority: c.priority || 0,
    exclusive: !!c.exclusive,
    badge: c.badgeText || "",
    subtitle: c.subtitle || "",
    hideWhenSoldOut: !!c.hideWhenSoldOut,
    rewardMode: c.rewardMode,
    startsAt: c.startsAt || "",
    endsAt: c.endsAt || "",
  };
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export type ProductFacts = {
  title: string;
  handle: string;
  image: string | null;
  vendor: string;
  productType: string;
  status: string; // ACTIVE | DRAFT | ARCHIVED
  totalInventory: number | null;
  tags: string[];
};

const PRODUCT_FIELDS = `id title handle vendor productType status totalInventory tags featuredImage { url }`;

function toFacts(n: any): ProductFacts {
  return {
    title: n.title ?? "",
    handle: n.handle ?? "",
    image: n.featuredImage?.url ?? null,
    vendor: n.vendor ?? "",
    productType: n.productType ?? "",
    status: n.status ?? "",
    totalInventory: typeof n.totalInventory === "number" ? n.totalInventory : null,
    tags: Array.isArray(n.tags) ? n.tags : [],
  };
}

/** Search-syntax quoting for a value (`tag:"Free gift"`). */
function q(v: string) {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Per-run caches: every collection / product search is fetched once per sync
 * even when several campaigns use it, and product facts are collected on the
 * way (no second lookup for the coverage index).
 */
function newCtx(admin: AdminGraphql) {
  const facts = new Map<string, ProductFacts>();
  const collections = new Map<string, string[]>();
  const searches = new Map<string, string[]>();

  async function page(query: string, variables: any, pick: (d: any) => any) {
    const ids: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 100; i++) {
      const json = await gql(admin, query, { ...variables, after });
      const conn = pick(json?.data);
      for (const n of conn?.nodes ?? []) {
        if (typeof n?.id !== "string") continue;
        ids.push(n.id);
        facts.set(n.id, toFacts(n));
      }
      if (!conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
    return ids;
  }

  return {
    facts,
    /** Every product in a collection (paged — no 250 cap). */
    async collection(id: string) {
      if (!collections.has(id)) {
        collections.set(
          id,
          await page(
            `#graphql
              query GiftColl($id: ID!, $after: String) {
                collection(id: $id) {
                  products(first: 250, after: $after) {
                    nodes { ${PRODUCT_FIELDS} }
                    pageInfo { hasNextPage endCursor }
                  }
                }
              }`,
            { id },
            (d) => d?.collection?.products,
          ),
        );
      }
      return collections.get(id)!;
    },
    /** Products matching a search query ("" = all products). */
    async search(query: string) {
      if (!searches.has(query)) {
        searches.set(
          query,
          await page(
            `#graphql
              query GiftSearch($q: String, $after: String) {
                products(first: 250, after: $after, query: $q) {
                  nodes { ${PRODUCT_FIELDS} }
                  pageInfo { hasNextPage endCursor }
                }
              }`,
            { q: query || null },
            (d) => d?.products,
          ),
        );
      }
      return searches.get(query)!;
    },
    /** Facts for products not seen during expansion (direct picks, gifts). */
    async fill(ids: string[]) {
      const missing = ids.filter((id) => !facts.has(id));
      for (let i = 0; i < missing.length; i += 100) {
        const json = await gql(
          admin,
          `#graphql
            query GiftFacts($ids: [ID!]!) {
              nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } }
            }`,
          { ids: missing.slice(i, i + 100) },
        );
        for (const n of json?.data?.nodes ?? []) {
          if (n?.id) facts.set(n.id, toFacts(n));
        }
      }
    },
  };
}

type Member = { via: string[]; triggerVariants?: string[] };

const lc = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

/** Which rule-based triggers a product matches (labels), before exclusions. */
function ruleLabels(
  c: GiftCampaign,
  p: ProductFacts,
  inCollection: (collectionId: string) => boolean,
): string[] {
  const labels: string[] = [];
  for (const coll of c.triggerCollections) {
    if (inCollection(coll.id)) labels.push(`Collection: ${coll.title || "Untitled"}`);
  }
  const tags = lc(p.tags);
  for (const t of c.triggerTags) if (tags.has(t.toLowerCase())) labels.push(`Tag: ${t}`);
  for (const v of c.triggerVendors)
    if (p.vendor.toLowerCase() === v.toLowerCase()) labels.push(`Brand: ${v}`);
  for (const t of c.triggerTypes)
    if (p.productType.toLowerCase() === t.toLowerCase()) labels.push(`Type: ${t}`);
  if (c.allProducts) labels.push("All products");
  return labels;
}

function isExcluded(c: GiftCampaign, id: string, p: ProductFacts) {
  if (c.excludeProducts.some((x) => x.id === id)) return true;
  const tags = lc(p.tags);
  return c.excludeTags.some((t) => tags.has(t.toLowerCase()));
}

function directMember(c: GiftCampaign, id: string): Member | null {
  const d = c.triggerProducts.find((x) => x.id === id);
  if (!d) return null;
  const tv = Array.isArray(d.variantIds) ? d.variantIds.map(gidTail).filter(Boolean) : [];
  return tv.length ? { via: ["Direct"], triggerVariants: tv } : { via: ["Direct"] };
}

/** Does one product trigger this campaign? (Webhook path.) */
function matchProduct(
  c: GiftCampaign,
  id: string,
  p: ProductFacts,
  collectionIds: Set<string>,
): Member | null {
  const direct = directMember(c, id);
  const rules = ruleLabels(c, p, (cid) => collectionIds.has(cid));
  const ruled = rules.length && !isExcluded(c, id, p) ? rules : [];
  if (!direct && !ruled.length) return null;
  return {
    via: [...(direct?.via ?? []), ...ruled],
    ...(direct?.triggerVariants ? { triggerVariants: direct.triggerVariants } : {}),
  };
}

/** Every product a campaign triggers, with how it got in. (Full-sync path.) */
async function resolveCampaign(
  ctx: ReturnType<typeof newCtx>,
  c: GiftCampaign,
): Promise<Map<string, Member>> {
  const out = new Map<string, Member>();
  // Candidates from the rule-based triggers, then the same exact matcher the
  // webhook path uses (search is fuzzy; this keeps both paths identical).
  const candidates = new Set<string>();
  const inColl = new Map<string, Set<string>>();
  for (const coll of c.triggerCollections) {
    const ids = await ctx.collection(coll.id);
    inColl.set(coll.id, new Set(ids));
    ids.forEach((id) => candidates.add(id));
  }
  if (c.allProducts) (await ctx.search("")).forEach((id) => candidates.add(id));
  else {
    for (const t of c.triggerTags) (await ctx.search(`tag:${q(t)}`)).forEach((id) => candidates.add(id));
    for (const v of c.triggerVendors) (await ctx.search(`vendor:${q(v)}`)).forEach((id) => candidates.add(id));
    for (const t of c.triggerTypes) (await ctx.search(`product_type:${q(t)}`)).forEach((id) => candidates.add(id));
  }
  for (const id of candidates) {
    const p = ctx.facts.get(id);
    if (!p) continue;
    const labels = ruleLabels(c, p, (cid) => inColl.get(cid)?.has(id) ?? false);
    if (labels.length && !isExcluded(c, id, p)) out.set(id, { via: labels });
  }
  for (const d of c.triggerProducts) {
    const m = directMember(c, d.id)!;
    const prev = out.get(d.id);
    out.set(d.id, prev ? { ...m, via: [...m.via, ...prev.via] } : m);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stamps                                                              */
/* ------------------------------------------------------------------ */

function canon(v: any): any {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const hashOf = (entries: any[]) =>
  createHash("sha1").update(JSON.stringify(canon(entries))).digest("hex");
const EMPTY_HASH = hashOf([]);

function desiredFor(
  enabled: GiftCampaign[],
  entries: Map<string, ReturnType<typeof campaignEntry>>,
  memberOf: (campaignId: string) => Member | null | undefined,
) {
  const arr: any[] = [];
  for (const c of enabled) {
    const m = memberOf(c.id);
    if (!m) continue;
    const e = entries.get(c.id)!;
    arr.push(m.triggerVariants?.length ? { ...e, triggerVariants: m.triggerVariants } : e);
  }
  return arr;
}

// Products we stamped in the last minute. Each write echoes back as a
// products/update webhook; skipping those avoids a query per written product.
const recentlyWritten = new Map<string, number>();
const ECHO_MS = 60_000;

async function writeStamps(
  admin: AdminGraphql,
  shop: string,
  stamps: Map<string, any[]>,
): Promise<string[]> {
  const errors: string[] = [];
  const list = [...stamps.entries()];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    const json = await gql(
      admin,
      `#graphql
        mutation GiftStamps($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { message } }
        }`,
      {
        metafields: chunk.map(([ownerId, entries]) => ({
          ownerId,
          namespace: GIFT_TRIGGER_NAMESPACE,
          key: GIFT_TRIGGER_KEY,
          type: "json",
          value: JSON.stringify(entries),
        })),
      },
    );
    const errs = (json?.data?.metafieldsSet?.userErrors ?? []).map((e: any) => e.message);
    errors.push(...errs);
    const now = Date.now();
    for (const [id] of chunk) recentlyWritten.set(`${shop} ${id}`, now);
    if (!errs.length) {
      await prisma.$transaction(
        chunk.map(([productId, entries]) =>
          prisma.giftStamp.upsert({
            where: { shop_productId: { shop, productId } },
            create: { shop, productId, hash: hashOf(entries) },
            update: { hash: hashOf(entries) },
          }),
        ),
      );
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Serialisation + logging                                             */
/* ------------------------------------------------------------------ */

// One sync at a time per shop (saves, webhooks and manual runs never interleave
// their writes). In-process; a single app instance serves the shop.
const chains = new Map<string, Promise<unknown>>();
function serial<T>(shop: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(shop) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(shop, next);
  return next;
}

async function log(
  shop: string,
  kind: string,
  scanned: number,
  changed: number,
  errors: string[],
) {
  await prisma.giftSyncLog
    .create({ data: { shop, kind, scanned, changed, errors: errors.join("; ").slice(0, 2000) } })
    .catch(() => {});
}

export type SyncResult = { scanned: number; changed: number; errors: string[] };

/* ------------------------------------------------------------------ */
/* Full sync                                                           */
/* ------------------------------------------------------------------ */

export function syncAll(
  admin: AdminGraphql,
  shop: string,
  kind = "full",
): Promise<SyncResult> {
  return serial(shop, async () => {
    const campaigns = (await prisma.giftCampaign.findMany({
        where: { shop },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      })).map(
      rowToCampaign,
    );
    const enabled = campaigns.filter((c) => c.enabled);
    const tz = await shopTimezone(admin);
    const ctx = newCtx(admin);

    const members = new Map<string, Map<string, Member>>();
    for (const c of campaigns) members.set(c.id, await resolveCampaign(ctx, c));

    // Products to (re)stamp: everything an ENABLED campaign triggers now ∪
    // everything we stamped non-empty before (so products that dropped out get
    // cleared). A product we never stamped is known to be empty, so members of
    // disabled campaigns cost nothing.
    const known = new Map(
      (
        await prisma.giftStamp.findMany({
          where: { shop },
          select: { productId: true, hash: true },
        })
      ).map((r) => [r.productId, r.hash]),
    );
    // First run after this engine shipped: stamps written by the old code have
    // no GiftStamp row yet — take the previous coverage as the candidate set.
    const migrating = known.size === 0;
    const union = new Set<string>();
    for (const c of enabled) for (const id of members.get(c.id)!.keys()) union.add(id);
    for (const [id, h] of known) if (h !== EMPTY_HASH) union.add(id);
    if (migrating) {
      const prev = await prisma.giftCoverage.findMany({
        where: { shop, role: "trigger" },
        select: { productId: true },
      });
      prev.forEach((r) => union.add(r.productId));
    }

    const giftIds = campaigns.flatMap((c) => c.giftProducts.map((g) => g.id));
    const coverageIds = campaigns.flatMap((c) => [...members.get(c.id)!.keys()]);
    await ctx.fill([...new Set([...union, ...giftIds, ...coverageIds])]);

    const entries = new Map(enabled.map((c) => [c.id, campaignEntry(c, tz)]));
    const toWrite = new Map<string, any[]>();
    const gone: string[] = [];
    for (const id of union) {
      if (!ctx.facts.has(id)) {
        gone.push(id); // deleted product — nothing to write to
        continue;
      }
      const desired = desiredFor(enabled, entries, (cid) => members.get(cid)!.get(id));
      const h = hashOf(desired);
      const cur = known.get(id);
      if (cur === h) continue;
      if (cur === undefined && !desired.length && !migrating) continue;
      toWrite.set(id, desired);
    }
    const errors = await writeStamps(admin, shop, toWrite);
    if (gone.length) await prisma.giftStamp.deleteMany({ where: { shop, productId: { in: gone } } });

    // Rewrite the coverage index from what we just resolved.
    const data: any[] = [];
    const row = (campaignId: string, productId: string, role: string, via: string[], fallback: string) => {
      const f = ctx.facts.get(productId);
      data.push({
        shop,
        campaignId,
        productId,
        role,
        viaJson: JSON.stringify(via),
        title: f?.title ?? fallback,
        handle: f?.handle ?? "",
        image: f?.image ?? null,
        vendor: f?.vendor ?? "",
        productType: f?.productType ?? "",
        status: f ? f.status : "DELETED",
        totalInventory: f?.totalInventory ?? null,
      });
    };
    for (const c of campaigns) {
      for (const [id, m] of members.get(c.id)!) {
        row(c.id, id, "trigger", m.via, c.triggerProducts.find((x) => x.id === id)?.title ?? "");
      }
      for (const g of c.giftProducts) row(c.id, g.id, "gift", [], g.title);
    }
    await prisma.$transaction([
      prisma.giftCoverage.deleteMany({ where: { shop } }),
      prisma.giftCoverage.createMany({ data, skipDuplicates: true }),
    ]);

    await log(shop, kind, union.size, toWrite.size, errors);
    // Keep the log short.
    const old = await prisma.giftSyncLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      skip: 100,
      select: { id: true },
    });
    if (old.length) await prisma.giftSyncLog.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });

    return { scanned: union.size, changed: toWrite.size, errors };
  });
}

/* ------------------------------------------------------------------ */
/* Single product (webhooks)                                           */
/* ------------------------------------------------------------------ */

export function syncProduct(
  admin: AdminGraphql,
  shop: string,
  productId: string,
): Promise<SyncResult> {
  return serial(shop, async () => {
    const campaigns = (await prisma.giftCampaign.findMany({
        where: { shop },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      })).map(
      rowToCampaign,
    );
    if (!campaigns.length) return { scanned: 0, changed: 0, errors: [] };

    const json = await gql(
      admin,
      `#graphql
        query GiftOne($id: ID!, $ns: String!, $key: String!) {
          product(id: $id) {
            ${PRODUCT_FIELDS}
            collections(first: 250) { nodes { id } }
            metafield(namespace: $ns, key: $key) { value }
          }
        }`,
      { id: productId, ns: GIFT_TRIGGER_NAMESPACE, key: GIFT_TRIGGER_KEY },
    );
    const p = json?.data?.product;
    if (!p) {
      // Deleted: drop it as a trigger; keep gift rows but flag them.
      await prisma.giftCoverage.deleteMany({ where: { shop, productId, role: "trigger" } });
      await prisma.giftCoverage.updateMany({
        where: { shop, productId, role: "gift" },
        data: { status: "DELETED" },
      });
      await prisma.giftStamp.deleteMany({ where: { shop, productId } });
      return { scanned: 1, changed: 0, errors: [] };
    }

    const facts = toFacts(p);
    const collectionIds = new Set<string>(
      (p.collections?.nodes ?? []).map((n: any) => n.id),
    );
    const members = new Map<string, Member>();
    for (const c of campaigns) {
      const m = matchProduct(c, productId, facts, collectionIds);
      if (m) members.set(c.id, m);
    }

    const enabled = campaigns.filter((c) => c.enabled);
    const needsTz = enabled.some((c) => members.has(c.id));
    const tz = needsTz ? await shopTimezone(admin) : "UTC";
    const entries = new Map(enabled.map((c) => [c.id, campaignEntry(c, tz)]));
    const desired = desiredFor(enabled, entries, (cid) => members.get(cid));

    // Compare against the LIVE value (also heals any drift in GiftStamp).
    let current: any = [];
    try {
      current = p.metafield?.value ? JSON.parse(p.metafield.value) : [];
    } catch {
      current = null;
    }
    const same =
      Array.isArray(current) && JSON.stringify(canon(current)) === JSON.stringify(canon(desired));
    let errors: string[] = [];
    if (!same) errors = await writeStamps(admin, shop, new Map([[productId, desired]]));
    else if (desired.length || p.metafield) {
      await prisma.giftStamp.upsert({
        where: { shop_productId: { shop, productId } },
        create: { shop, productId, hash: hashOf(desired) },
        update: { hash: hashOf(desired) },
      });
    }

    // Coverage rows for this product.
    const base = {
      shop,
      productId,
      title: facts.title,
      handle: facts.handle,
      image: facts.image,
      vendor: facts.vendor,
      productType: facts.productType,
      status: facts.status,
      totalInventory: facts.totalInventory,
    };
    await prisma.$transaction([
      prisma.giftCoverage.deleteMany({ where: { shop, productId, role: "trigger" } }),
      prisma.giftCoverage.createMany({
        data: [...members].map(([campaignId, m]) => ({
          ...base,
          campaignId,
          role: "trigger",
          viaJson: JSON.stringify(m.via),
        })),
        skipDuplicates: true,
      }),
      prisma.giftCoverage.updateMany({
        where: { shop, productId, role: "gift" },
        data: {
          title: facts.title,
          handle: facts.handle,
          image: facts.image,
          vendor: facts.vendor,
          productType: facts.productType,
          status: facts.status,
          totalInventory: facts.totalInventory,
        },
      }),
    ]);

    if (!same || errors.length) await log(shop, "product", 1, same ? 0 : 1, errors);
    return { scanned: 1, changed: same ? 0 : 1, errors };
  });
}

/* ------------------------------------------------------------------ */
/* Webhook queue                                                       */
/* ------------------------------------------------------------------ */

// Webhooks arrive in bursts (bulk edits) and our own stamp writes echo back as
// products/update. Debounce per shop, collapse duplicates, and wait a few
// seconds so Shopify has updated smart-collection membership first.
const DEBOUNCE_MS = 5000;
const queued = new Map<string, { ids: Set<string>; full: boolean; timer: NodeJS.Timeout }>();

function schedule(shop: string, apply: (q: { ids: Set<string>; full: boolean }) => void) {
  let q = queued.get(shop);
  if (!q) {
    q = { ids: new Set(), full: false, timer: setTimeout(() => void flush(shop), DEBOUNCE_MS) };
    queued.set(shop, q);
  }
  apply(q);
}

async function flush(shop: string) {
  const q = queued.get(shop);
  queued.delete(shop);
  if (!q) return;
  try {
    const { admin } = await unauthenticated.admin(shop);
    if (q.full) await syncAll(admin, shop, "collection");
    else for (const id of q.ids) await syncProduct(admin, shop, id);
  } catch (e) {
    console.error(`[gifts] background sync failed for ${shop}:`, e);
    await log(shop, q.full ? "collection" : "product", q.ids.size, 0, [String((e as Error)?.message ?? e)]);
  }
}

/** A product was created / updated / deleted. */
export async function queueProductSync(shop: string, productId: string) {
  const key = `${shop} ${productId}`;
  const at = recentlyWritten.get(key);
  if (at && Date.now() - at < ECHO_MS) return; // our own write echoing back
  if (at) recentlyWritten.delete(key);
  // Nothing to do for shops without campaigns (the common case for most edits).
  if (!(await prisma.giftCampaign.count({ where: { shop } }))) return;
  schedule(shop, (q) => {
    if (!q.full) q.ids.add(productId);
  });
}

/** A collection changed: re-sync if any campaign triggers on it. */
export async function queueCollectionSync(shop: string, collectionId: string) {
  const rows = await prisma.giftCampaign.findMany({
    where: { shop },
    select: { triggerCollectionsJson: true },
  });
  if (!rows.some((r) => r.triggerCollectionsJson.includes(`"${collectionId}"`))) return;
  schedule(shop, (q) => {
    q.full = true;
    q.ids.clear();
  });
}

/** Latest sync run, for the admin ("Last sync …"). */
export async function lastSync(shop: string) {
  const r = await prisma.giftSyncLog.findFirst({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
  return r
    ? { at: r.createdAt.toISOString(), kind: r.kind, changed: r.changed, errors: r.errors }
    : null;
}
