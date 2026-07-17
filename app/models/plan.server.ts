import prisma from "../db.server";
import { PRO_PLAN, BILLING_TEST, BILLING_ENABLED } from "../shopify.server";
import { FREE_PRODUCT_LIMIT, FREE_CAMPAIGN_LIMIT } from "./plan";

/**
 * Freemium gating. Free tier: FREE_PRODUCT_LIMIT configured products and
 * FREE_CAMPAIGN_LIMIT gift campaigns — enough to try everything (and for app
 * review), Pro unlocks unlimited. Checks are enforced server-side at save time
 * so the limits can't be bypassed from the UI.
 */

// Structural-only: the real BillingContext's `plans` is keyed to the app
// config's plan names, which doesn't flow through here — accept anything.
type Billing = {
  check: (opts?: any) => Promise<{ hasActivePayment: boolean }>;
};

export async function hasPro(billing: Billing): Promise<boolean> {
  try {
    const { hasActivePayment } = await billing.check({
      plans: [PRO_PLAN],
      isTest: BILLING_TEST,
    });
    return hasActivePayment;
  } catch {
    return false;
  }
}

const UPGRADE_MSG =
  "Free plan limit reached. Upgrade to Pro (14-day free trial) on the Plan page for unlimited products and campaigns.";

/**
 * May this shop save an offer config for `productId`? Always OK on Pro or when
 * the product is already configured (editing); on Free, only while under the
 * product limit.
 */
export async function canConfigureProduct(
  billing: Billing,
  shop: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!BILLING_ENABLED) return { ok: true }; // free launch → no limits
  if (await hasPro(billing)) return { ok: true };
  const existing = await prisma.bundleConfig.findMany({
    where: { shop },
    select: { productId: true },
  });
  if (existing.some((r) => r.productId === productId)) return { ok: true };
  if (existing.length < FREE_PRODUCT_LIMIT) return { ok: true };
  return { ok: false, error: UPGRADE_MSG };
}

/** May this shop create ANOTHER gift campaign? (Editing existing is always OK.) */
export async function canCreateCampaign(
  billing: Billing,
  shop: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!BILLING_ENABLED) return { ok: true }; // free launch → no limits
  if (await hasPro(billing)) return { ok: true };
  const count = await prisma.giftCampaign.count({ where: { shop } });
  if (count < FREE_CAMPAIGN_LIMIT) return { ok: true };
  return { ok: false, error: UPGRADE_MSG };
}
