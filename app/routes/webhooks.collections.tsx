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
    if (e instanceof Response) return e;
    return new Response("Unauthorized", { status: 401 });
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
