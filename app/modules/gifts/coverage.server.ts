/**
 * Gifts module — coverage index (read side).
 *
 * Answers "which products give which gifts" without re-expanding campaigns on
 * each page view. The index (GiftCoverage) is written by the sync engine
 * (engine.server.ts) on every campaign save / delete, manual re-sync and
 * product / collection webhook; campaigns stay the source of truth.
 */
import prisma from "../../db.server";
import { syncAll, type SyncResult } from "./engine.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};

/** Full re-sync: re-resolve every campaign, rewrite changed stamps + the index. */
export function rebuildCoverage(admin: AdminGraphql, shop: string): Promise<SyncResult> {
  return syncAll(admin, shop, "full");
}

/** Forget a deleted campaign's rows. */
export async function dropCoverage(shop: string, campaignId: string) {
  await prisma.giftCoverage.deleteMany({ where: { shop, campaignId } });
}

/**
 * Make sure the index exists before a view reads it: build it once if the shop
 * has campaigns but no rows yet (first visit after this feature shipped).
 */
export async function ensureCoverage(admin: AdminGraphql, shop: string) {
  const [rows, campaigns] = await Promise.all([
    prisma.giftCoverage.count({ where: { shop } }),
    prisma.giftCampaign.count({ where: { shop } }),
  ]);
  if (rows === 0 && campaigns > 0) await syncAll(admin, shop, "full");
}

/** When the index was last written (for the "updated …" line in the views). */
export async function coverageUpdatedAt(shop: string): Promise<string | null> {
  const r = await prisma.giftCoverage.findFirst({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return r ? r.updatedAt.toISOString() : null;
}
