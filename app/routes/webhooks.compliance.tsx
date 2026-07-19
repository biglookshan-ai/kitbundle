import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory privacy/compliance webhooks (App Store requirement).
 * https://shopify.dev/docs/apps/build/privacy-law-compliance
 *
 * This app stores NO customer personal data — only shop-level config
 * (per-product offer settings and our own discount node ids). So:
 *  - customers/data_request → nothing to return.
 *  - customers/redact       → nothing to delete.
 *  - shop/redact            → purge every record we hold for that shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // HMAC/auth failures MUST return 401 (App Store requirement). authenticate.webhook
  // throws on an invalid digest; surface that as 401, never a 500.
  let auth;
  try {
    auth = await authenticate.webhook(request);
  } catch (e) {
    if (e instanceof Response) return e; // library's own 401
    return new Response("Unauthorized", { status: 401 });
  }
  const { shop, topic } = auth;

  console.log(`Received compliance webhook ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // We never store customer personal data.
      break;
    case "SHOP_REDACT":
      await db.bundleConfig.deleteMany({ where: { shop } }).catch(() => {});
      await db.giftCampaign.deleteMany({ where: { shop } }).catch(() => {});
      await db.session.deleteMany({ where: { shop } }).catch(() => {});
      break;
    default:
      break;
  }

  return new Response();
};
