import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { queueProductSync } from "../modules/gifts/engine.server";

/**
 * products/create · update · delete → keep that product's gift stamp in step
 * (tag / brand / type / collection changes can add or remove it from a
 * campaign). Queued and debounced; we answer Shopify immediately.
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
  const p = payload as { admin_graphql_api_id?: string; id?: number | string };
  const productId =
    p?.admin_graphql_api_id || (p?.id ? `gid://shopify/Product/${p.id}` : "");
  console.log(`[gifts] ${topic} ${shop} ${productId}`);
  if (productId) {
    void queueProductSync(shop, productId).catch((e) =>
      console.error("[gifts] queue product sync failed", e),
    );
  }
  return new Response();
};
