import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";

import { PRO_PLAN } from "./models/plan";
export { PRO_PLAN } from "./models/plan";
/**
 * Test charges while developing; set SHOPIFY_BILLING_TEST=false in Railway
 * before App Store launch so real merchants are actually billed.
 */
export const BILLING_TEST = process.env.SHOPIFY_BILLING_TEST !== "false";
/**
 * Master switch. Launch FREE: with this off (default) everything is unlimited,
 * the Plan page is hidden, and no billing calls happen. Flip BILLING_ENABLED=true
 * in Railway later to turn on the Pro plan + free-tier limits — no code changes.
 */
export const BILLING_ENABLED = process.env.BILLING_ENABLED === "true";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureFunctionDiscount } from "./models/function-discount.server";

const shopify = shopifyApp({
  billing: {
    [PRO_PLAN]: {
      trialDays: 7,
      lineItems: [
        {
          amount: 29,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  hooks: {
    // Runs on install / re-auth. Activate the Function's automatic discount so
    // merchants never have to do it manually; failures are non-fatal (the
    // Discount settings page can repair later).
    afterAuth: async ({ admin }) => {
      try {
        const r = await ensureFunctionDiscount(admin);
        if (!r.ok) console.warn("KitBundle discount activation:", r.error);
      } catch (e) {
        console.warn("KitBundle discount activation failed:", e);
      }
    },
  },
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
