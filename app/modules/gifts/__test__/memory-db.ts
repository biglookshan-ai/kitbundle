/**
 * Tiny in-memory stand-in for the Prisma client, covering just the queries the
 * gifts module uses. Tests only.
 */
type Row = Record<string, any>;
export const db: Record<string, Row[]> = {};

const cmp = (v: any) => (v instanceof Date ? v.getTime() : v);
function fieldMatch(value: any, cond: any): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
    if ("in" in cond) return cond.in.includes(value);
    if ("not" in cond) return value !== cond.not;
    let ok = true;
    if ("gt" in cond) ok &&= value != null && cmp(value) > cmp(cond.gt);
    if ("gte" in cond) ok &&= value != null && cmp(value) >= cmp(cond.gte);
    if ("lt" in cond) ok &&= value != null && cmp(value) < cmp(cond.lt);
    if ("lte" in cond) ok &&= value != null && cmp(value) <= cmp(cond.lte);
    return ok;
  }
  // Unset columns read as null, like the database.
  return (value ?? null) === cond;
}
export function match(r: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((w) => match(r, w));
    if (k === "shop_productId") return r.shop === v.shop && r.productId === v.productId;
    return fieldMatch(r[k], v);
  });
}

export const table = (name: string) => ({
  findMany: async (a: Row = {}) => {
    let rows = (db[name] ??= []).filter((r) => match(r, a.where));
    if (a.orderBy?.createdAt === "desc") rows = [...rows].reverse();
    if (a.skip) rows = rows.slice(a.skip);
    if (a.distinct) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const key = a.distinct.map((k: string) => r[k]).join("|");
        return seen.has(key) ? false : (seen.add(key), true);
      });
    }
    return rows;
  },
  findFirst: async (a: Row = {}) => (await table(name).findMany(a))[0] ?? null,
  findUnique: async (a: Row = {}) => (await table(name).findMany(a))[0] ?? null,
  count: async (a: Row = {}) => (db[name] ??= []).filter((r) => match(r, a.where)).length,
  create: async (a: Row) => {
    (db[name] ??= []).push({ createdAt: new Date(), ...a.data });
  },
  createMany: async (a: Row) => {
    (db[name] ??= []).push(...a.data);
  },
  deleteMany: async (a: Row = {}) => {
    db[name] = (db[name] ??= []).filter((r) => !match(r, a.where));
  },
  update: async (a: Row) => {
    const r = (db[name] ??= []).find((x) => match(x, a.where));
    if (r) Object.assign(r, a.data);
    return r;
  },
  updateMany: async (a: Row) => {
    const rows = (db[name] ??= []).filter((r) => match(r, a.where));
    for (const r of rows) Object.assign(r, a.data);
    return { count: rows.length };
  },
  upsert: async (a: Row) => {
    const r = (db[name] ??= []).find((x) => match(x, a.where));
    if (r) Object.assign(r, a.update);
    else db[name].push({ ...a.create });
  },
});

export const prismaMock = {
  giftCampaign: table("giftCampaign"),
  giftCoverage: table("giftCoverage"),
  giftStamp: table("giftStamp"),
  giftSyncLog: table("giftSyncLog"),
  giftSchedulerState: table("giftSchedulerState"),
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};
