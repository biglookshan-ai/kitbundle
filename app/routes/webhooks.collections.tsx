import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { queueCollectionSync } from "../modules/gifts/engine.server";

/**
 * collections/update · delete → if a gift campaign triggers on this
 * collection, re-sync (products that joined get the gift, products that left
 * lose it). Queued and debounced; we answer Shopify immediately.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let auth;
  try {
    auth = await authenticate.webhook(request);
  } catch (e) {
    // Invalid HMAC → the library throws a 401 Response (must stay 401). Any
    // other failure is ours: log it and 500 so Shopify retries.
    if (e instanceof Response) {
      console.warn(`[gifts] webhook rejected: ${e.status} ${request.headers.get("x-shopify-topic")}`);
      return e;
    }
    console.error("[gifts] webhook auth error", e);
    return new Response("Error", { status: 500 });
  }
  const { shop, payload, topic } = auth;
  const c = payload as { admin_graphql_api_id?: string; id?: number | string };
  const collectionId =
    c?.admin_graphql_api_id || (c?.id ? `gid://shopify/Collection/${c.id}` : "");
  console.log(`[gifts] ${topic} ${shop} ${collectionId}`);
  if (collectionId) {
    void queueCollectionSync(shop, collectionId).catch((e) =>
      console.error("[gifts] queue collection sync failed", e),
    );
  }
  return new Response();
};
