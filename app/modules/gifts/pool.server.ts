/**
 * Gifts module — the gift pool: products set aside to give away. Campaigns
 * still decide who gets what; the pool is the shortlist to pick from.
 */
import prisma from "../../db.server";
import { getCampaign, saveCampaign } from "../../models/gift-campaign.server";
import type { Ref } from "../../models/gift-campaign";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

export async function listPool(shop: string) {
  return prisma.giftPoolItem.findMany({ where: { shop }, orderBy: { createdAt: "desc" } });
}

export async function addToPool(shop: string, refs: Ref[]) {
  for (const r of refs) {
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(r.id)) continue;
    await prisma.giftPoolItem.upsert({
      where: { shop_productId: { shop, productId: r.id } },
      create: {
        shop,
        productId: r.id,
        title: r.title || "",
        handle: r.handle || "",
        image: r.image ?? null,
      },
      update: { title: r.title || "", handle: r.handle || "", image: r.image ?? null },
    });
  }
}

export async function removeFromPool(shop: string, productId: string) {
  await prisma.giftPoolItem.deleteMany({ where: { shop, productId } });
}

/** Add one gift to an existing campaign (and re-sync, like a save). */
export async function addGiftToCampaign(
  admin: AdminGraphql,
  shop: string,
  campaignId: string,
  gift: Ref,
): Promise<{ ok: boolean; errors: string[]; already?: boolean }> {
  const c = await getCampaign(shop, campaignId);
  if (!c) return { ok: false, errors: ["Campaign not found."] };
  if (c.giftProducts.some((g) => g.id === gift.id)) return { ok: true, errors: [], already: true };
  c.giftProducts = [...c.giftProducts, { ...gift, qty: 1 }];
  return saveCampaign(admin, shop, c);
}
