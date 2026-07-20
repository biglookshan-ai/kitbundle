/**
 * The app-owned automatic discount that activates our product-discount
 * Function. Without this discount the Function never runs, so we ensure it
 * exists right after install (afterAuth) — merchants shouldn't need to know
 * about this step. The Discount settings page reuses the same logic as a
 * status/repair surface.
 */

export const DISCOUNT_TITLE = "KitBundle discount";
/** Legacy title used by early dev builds; treated as already-activated. */
export const LEGACY_DISCOUNT_TITLES = ["Add-on & Bundle discount"];
export const PRODUCT_DISCOUNT_API_TYPE = "product_discounts";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

/** Our deployed product-discount Function's id (null if not deployed yet). */
export async function findDiscountFunctionId(
  admin: AdminGraphql,
): Promise<string | null> {
  const resp = await admin.graphql(
    `#graphql
      query DiscountFunctions {
        shopifyFunctions(first: 50) {
          nodes { id title apiType }
        }
      }`,
  );
  const json = await resp.json();
  const fn = (json?.data?.shopifyFunctions?.nodes ?? []).find(
    (n: any) => n.apiType === PRODUCT_DISCOUNT_API_TYPE,
  );
  return fn?.id ?? null;
}

/** The existing activation discount, if any. */
export async function findExistingDiscount(
  admin: AdminGraphql,
): Promise<{ id: string; title: string; status: string } | null> {
  // App/Function discounts are DiscountAutomaticApp and are returned by
  // `discountNodes`, NOT `automaticDiscountNodes` (which only lists the built-in
  // Basic/Bxgy/FreeShipping types). Using the wrong query made this always come
  // back empty, so the UI wrongly showed "Not active" even though the discount
  // exists and is applying at checkout.
  const resp = await admin.graphql(
    `#graphql
      query ExistingAppDiscounts {
        discountNodes(first: 250) {
          nodes {
            id
            discount {
              __typename
              ... on DiscountAutomaticApp { title status }
            }
          }
        }
      }`,
  );
  const json = await resp.json();
  const titles = [DISCOUNT_TITLE, ...LEGACY_DISCOUNT_TITLES];
  const node = (json?.data?.discountNodes?.nodes ?? []).find((n: any) =>
    titles.includes(n.discount?.title),
  );
  if (!node) return null;
  return {
    id: node.id,
    title: node.discount.title,
    status: node.discount.status ?? "UNKNOWN",
  };
}

/**
 * Idempotently create the activation discount. Returns { ok, error }.
 * Safe to call on every install/auth — it no-ops when already present.
 */
export async function ensureFunctionDiscount(
  admin: AdminGraphql,
): Promise<{ ok: boolean; error: string | null }> {
  const existing = await findExistingDiscount(admin);
  if (existing) return { ok: true, error: null };

  const functionId = await findDiscountFunctionId(admin);
  if (!functionId) {
    return {
      ok: false,
      error:
        "No product-discount function found. Deploy the app first with `shopify app deploy`.",
    };
  }

  const resp = await admin.graphql(
    `#graphql
      mutation CreateKitBundleDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        automaticAppDiscount: {
          title: DISCOUNT_TITLE,
          functionId,
          startsAt: new Date().toISOString(),
          combinesWith: {
            productDiscounts: true,
            orderDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    },
  );
  const json = await resp.json();
  const errs = json?.data?.discountAutomaticAppCreate?.userErrors ?? [];
  if (errs.length > 0) {
    // "Title must be unique" means our discount already exists — activated.
    const onlyDuplicate = errs.every((e: any) =>
      /unique|already exists|taken/i.test(e.message ?? ""),
    );
    if (onlyDuplicate) return { ok: true, error: null };
    return { ok: false, error: errs.map((e: any) => e.message).join("; ") };
  }
  return { ok: true, error: null };
}
