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

/**
 * Shops that get full access for free (your own store, partners, comps). Set
 * FREE_SHOPS in the environment as a comma-separated list of *.myshopify.com
 * domains (the ".myshopify.com" suffix is optional). Matched case-insensitively.
 */
// Always-comped stores (the developer's own). Extend via the FREE_SHOPS env
// (comma-separated) without a code change.
const DEFAULT_FREE_SHOPS = ["cinegearpro"];
const FREE_SHOPS = new Set(
  DEFAULT_FREE_SHOPS.concat((process.env.FREE_SHOPS ?? "").split(","))
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\.myshopify\.com$/, ""),
    )
    .filter(Boolean),
);

export function isFreeShop(shop: string): boolean {
  const key = String(shop || "")
    .trim()
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "");
  return FREE_SHOPS.has(key);
}

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
  "Free plan limit reached. Upgrade to Pro (7-day free trial) on the Plan page for unlimited products and campaigns.";

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
  if (isFreeShop(shop)) return { ok: true }; // comped store (e.g. your own)
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
  if (isFreeShop(shop)) return { ok: true }; // comped store (e.g. your own)
  if (await hasPro(billing)) return { ok: true };
  const count = await prisma.giftCampaign.count({ where: { shop } });
  if (count < FREE_CAMPAIGN_LIMIT) return { ok: true };
  return { ok: false, error: UPGRADE_MSG };
}
