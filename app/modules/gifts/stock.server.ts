/**
 * Gifts module — live stock per location + price for a handful of products
 * (the rows on screen). Needs read_inventory / read_locations; without them
 * the stock part comes back empty with `needsAccess`.
 */
type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

export type StockInfo = {
  total: number | null;
  tracked: boolean;
  byLocation: { name: string; qty: number }[];
};
export type PriceInfo = { amount: number; compareAt: number | null; currency: string };

const BATCH = 6; // ~100 cost points per product (10 variants × 10 locations)

export async function stockAndPrice(
  admin: AdminGraphql,
  ids: string[],
): Promise<{
  stock: Record<string, StockInfo>;
  price: Record<string, PriceInfo>;
  needsAccess: boolean;
}> {
  const stock: Record<string, StockInfo> = {};
  const price: Record<string, PriceInfo> = {};
  let needsAccess = false;
  const clean = [...new Set(ids.filter((x) => /^gid:\/\/shopify\/Product\/\d+$/.test(x)))].slice(0, 120);
  for (let i = 0; i < clean.length; i += BATCH) {
    const batch = clean.slice(i, i + BATCH);
    let json: any;
    try {
      const resp = await admin.graphql(
        `#graphql
          query GiftStock($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                tracksInventory
                totalInventory
                priceRangeV2 { minVariantPrice { amount currencyCode } }
                compareAtPriceRange { minVariantCompareAtPrice { amount } }
                variants(first: 10) {
                  nodes {
                    inventoryItem {
                      tracked
                      inventoryLevels(first: 10) {
                        nodes {
                          location { name }
                          quantities(names: ["available"]) { quantity }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`,
        { variables: { ids: batch } },
      );
      json = await resp.json();
    } catch (e) {
      // Missing scope → the whole query is rejected; retry without stock.
      needsAccess = /access|scope|permission/i.test(String((e as Error)?.message ?? e));
      json = null;
    }
    if (!json?.data?.nodes) {
      needsAccess = true;
      const resp = await admin.graphql(
        `#graphql
          query GiftPrice($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                tracksInventory
                totalInventory
                priceRangeV2 { minVariantPrice { amount currencyCode } }
                compareAtPriceRange { minVariantCompareAtPrice { amount } }
              }
            }
          }`,
        { variables: { ids: batch } },
      );
      json = await resp.json();
    }
    for (const n of json?.data?.nodes ?? []) {
      if (!n?.id) continue;
      const mv = n.priceRangeV2?.minVariantPrice;
      if (mv) {
        const cmp = Number(n.compareAtPriceRange?.minVariantCompareAtPrice?.amount);
        price[n.id] = {
          amount: Number(mv.amount) || 0,
          compareAt: cmp > 0 ? cmp : null,
          currency: mv.currencyCode || "GBP",
        };
      }
      const byLoc = new Map<string, number>();
      let anyTracked = false;
      for (const v of n.variants?.nodes ?? []) {
        if (!v?.inventoryItem?.tracked) continue;
        anyTracked = true;
        for (const lvl of v.inventoryItem.inventoryLevels?.nodes ?? []) {
          const name = lvl?.location?.name || "Location";
          const q = Number(lvl?.quantities?.[0]?.quantity) || 0;
          byLoc.set(name, (byLoc.get(name) ?? 0) + q);
        }
      }
      const tracked = anyTracked || !!n.tracksInventory;
      stock[n.id] = {
        tracked,
        total: tracked ? (typeof n.totalInventory === "number" ? n.totalInventory : null) : null,
        byLocation: [...byLoc].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
      };
    }
  }
  return { stock, price, needsAccess };
}
