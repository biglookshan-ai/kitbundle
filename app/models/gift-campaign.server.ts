import prisma from "../db.server";
import {
  GIFT_TRIGGER_NAMESPACE,
  GIFT_TRIGGER_KEY,
  rowToCampaign,
  campaignState,
  cleanStrings,
  type GiftCampaign,
  type ProductGiftInfo,
} from "./gift-campaign";
import { syncAll } from "../modules/gifts/engine.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

/**
 * Which enabled gift campaigns give a free gift when THIS product is bought. Reads
 * the product's own `custom.gift_trigger` stamp (the exact source the storefront
 * + Function use, so it's accurate) and joins it with the DB campaigns for titles,
 * state and gift details. Read-only; for the product editor's info card.
 */
export async function getProductGiftInfo(
  admin: AdminGraphql,
  shop: string,
  productId: string,
): Promise<ProductGiftInfo[]> {
  const resp = await admin.graphql(
    `#graphql
      query GiftTrigger($id: ID!, $ns: String!, $key: String!) {
        product(id: $id) {
          metafield(namespace: $ns, key: $key) { value }
        }
      }`,
    {
      variables: {
        id: productId,
        ns: GIFT_TRIGGER_NAMESPACE,
        key: GIFT_TRIGGER_KEY,
      },
    },
  );
  const json = await resp.json();
  let entries: any[] = [];
  try {
    entries = JSON.parse(json?.data?.product?.metafield?.value ?? "[]");
  } catch {
    entries = [];
  }
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const campIds = new Set(
    entries
      .map((e) => (e && typeof e === "object" ? e.id : e))
      .filter((x) => typeof x === "string"),
  );
  if (campIds.size === 0) return [];

  const rows = await prisma.giftCampaign.findMany({ where: { shop } });
  const out: ProductGiftInfo[] = [];
  for (const row of rows) {
    if (!campIds.has(row.id)) continue;
    const c = rowToCampaign(row);
    out.push({
      id: c.id,
      title: c.title || "Untitled gift",
      state: campaignState(c),
      badge: c.badgeText || "",
      perQualifying: Math.max(1, c.perQualifying || 1),
      gifts: c.giftProducts.map((g) => ({
        title: g.title,
        image: g.image ?? null,
      })),
    });
  }
  return out;
}

// ---- public API ----

export async function listCampaigns(shop: string): Promise<GiftCampaign[]> {
  const rows = await prisma.giftCampaign.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(rowToCampaign);
}

export async function getCampaign(
  shop: string,
  id: string,
): Promise<GiftCampaign | null> {
  const row = await prisma.giftCampaign.findFirst({ where: { shop, id } });
  return row ? rowToCampaign(row) : null;
}

export async function saveCampaign(
  admin: AdminGraphql,
  shop: string,
  c: GiftCampaign,
): Promise<{ ok: boolean; errors: string[] }> {
  const prev = await prisma.giftCampaign.findFirst({ where: { shop, id: c.id } });

  // 1. Gifts are priced by the MAIN discount node (which reads each trigger
  //    product's gift_trigger stamp), so a campaign needs NO automatic-discount
  //    node of its own — a separate one would be a 3rd product discount that
  //    Shopify drops next to a limited-bundle node. Delete any legacy node.
  const errors: string[] = [];
  if (prev?.nodeId) {
    const resp = await admin.graphql(
      `#graphql
        mutation DeleteGiftNode($id: ID!) {
          discountAutomaticDelete(id: $id) { userErrors { message } }
        }`,
      { variables: { id: prev.nodeId } },
    );
    const json = await resp.json();
    for (const e of json?.data?.discountAutomaticDelete?.userErrors ?? [])
      errors.push(e.message);
  }

  // 2. Persist (source of truth).
  const data = {
    shop,
    title: c.title,
    enabled: c.enabled,
    startsAt: c.startsAt ? new Date(c.startsAt) : null,
    endsAt: c.endsAt ? new Date(c.endsAt) : null,
    perQualifying: Math.max(1, c.perQualifying || 1),
    rewardMode:
      c.rewardMode === "choice"
        ? "choice"
        : c.rewardMode === "all"
          ? "all"
          : "fixed",
    chooseCount: Math.max(1, Math.floor(Number(c.chooseCount)) || 1),
    rulesVersion: 2,
    badgeText: c.badgeText,
    subtitle: c.subtitle ?? "",
    hideWhenSoldOut: !!c.hideWhenSoldOut,
    triggerProductsJson: JSON.stringify(c.triggerProducts),
    triggerCollectionsJson: JSON.stringify(c.triggerCollections),
    triggerTagsJson: JSON.stringify(cleanStrings(c.triggerTags)),
    triggerVendorsJson: JSON.stringify(cleanStrings(c.triggerVendors)),
    triggerTypesJson: JSON.stringify(cleanStrings(c.triggerTypes)),
    allProducts: !!c.allProducts,
    excludeTagsJson: JSON.stringify(cleanStrings(c.excludeTags)),
    excludeProductsJson: JSON.stringify(c.excludeProducts ?? []),
    giftProductsJson: JSON.stringify(c.giftProducts),
    nodeId: null, // no separate gift node any more
  };
  await prisma.giftCampaign.upsert({
    where: { id: c.id },
    create: { id: c.id, ...data },
    update: data,
  });

  // 3. Re-sync stamps + the coverage index (only changed products are written;
  //    products that dropped out of this campaign are cleared).
  const r = await syncAll(admin, shop, "save");
  errors.push(...r.errors);
  return { ok: errors.length === 0, errors };
}

export async function deleteCampaign(
  admin: AdminGraphql,
  shop: string,
  id: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const row = await prisma.giftCampaign.findFirst({ where: { shop, id } });
  if (!row) return { ok: true, errors: [] };
  const errors: string[] = [];

  if (row.nodeId) {
    const resp = await admin.graphql(
      `#graphql
        mutation DeleteGift($id: ID!) {
          discountAutomaticDelete(id: $id) { userErrors { message } }
        }`,
      { variables: { id: row.nodeId } },
    );
    const json = await resp.json();
    for (const e of json?.data?.discountAutomaticDelete?.userErrors ?? [])
      errors.push(e.message);
  }

  // Forget the row first so the sync recomputes WITHOUT this campaign.
  await prisma.giftCampaign.delete({ where: { id } });
  const r = await syncAll(admin, shop, "delete");
  errors.push(...r.errors);
  return { ok: errors.length === 0, errors };
}

/** Re-resolve every campaign and rewrite changed stamps (manual sync). */
export async function resyncAll(
  admin: AdminGraphql,
  shop: string,
): Promise<{ ok: boolean; errors: string[]; changed: number }> {
  const r = await syncAll(admin, shop, "full");
  return { ok: r.errors.length === 0, errors: r.errors, changed: r.changed };
}
