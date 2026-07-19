import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // HMAC/auth failures MUST return 401 (App Store requirement), never a 500.
  let auth;
  try {
    auth = await authenticate.webhook(request);
  } catch (e) {
    if (e instanceof Response) return e;
    return new Response("Unauthorized", { status: 401 });
  }
  const { shop, session, topic } = auth;

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Clean uninstall: drop the shop's config rows too. (Shopify removes the
  // app-owned discount, metafields and theme blocks by itself.)
  await db.bundleConfig.deleteMany({ where: { shop } }).catch(() => {});
  await db.giftCampaign.deleteMany({ where: { shop } }).catch(() => {});

  return new Response();
};
