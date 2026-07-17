import prisma from "../db.server";

export type ShopSettings = {
  tagOffers: boolean;
  offerTag: string;
};

const DEFAULTS: ShopSettings = { tagOffers: false, offerTag: "kitbundle" };

/** Sanitize a tag: lowercase, spaces→hyphens, safe characters only. */
export function normalizeTag(raw: string): string {
  const t = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  return t || DEFAULTS.offerTag;
}

export async function getShopSettings(shop: string): Promise<ShopSettings> {
  const row = await prisma.shopSettings.findUnique({ where: { shop } });
  return {
    tagOffers: row?.tagOffers ?? DEFAULTS.tagOffers,
    offerTag: row?.offerTag ?? DEFAULTS.offerTag,
  };
}

export async function saveShopSettings(
  shop: string,
  input: Partial<ShopSettings>,
): Promise<ShopSettings> {
  const tagOffers = Boolean(input.tagOffers);
  const offerTag = normalizeTag(input.offerTag ?? DEFAULTS.offerTag);
  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, tagOffers, offerTag },
    update: { tagOffers, offerTag },
  });
  return { tagOffers, offerTag };
}

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

/**
 * Reflect the offer tag on a product: add `offerTag` when the product has ≥1
 * live offer AND the shop opted in; otherwise remove it. Only touches OUR tag,
 * never other tags. No-op (and never adds) when tagging is off.
 */
export async function syncOfferTag(
  admin: AdminGraphql,
  shop: string,
  productId: string,
  hasLiveOffer: boolean,
): Promise<void> {
  const { tagOffers, offerTag } = await getShopSettings(shop);
  // When tagging is disabled we still REMOVE a previously-added tag (so turning
  // it off cleans up), but never add.
  const mutation = tagOffers && hasLiveOffer ? "tagsAdd" : "tagsRemove";
  await admin
    .graphql(
      `#graphql
        mutation OfferTag($id: ID!, $tags: [String!]!) {
          ${mutation}(id: $id, tags: $tags) { userErrors { message } }
        }`,
      { variables: { id: productId, tags: [offerTag] } },
    )
    .catch(() => {});
}
