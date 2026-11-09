import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { queueIncludedOrder } from "../modules/gifts/included-orders.server";

/**
 * orders/create → "Added to the order only" campaigns: add the included parts
 * to the new order at £0. We answer Shopify immediately; the work runs after
 * (claimed once per order, retried by the scheduler if it fails).
 * Only the order id / name are kept — no customer details.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  let auth;
  try {
    auth = await authenticate.webhook(request);
  } catch (e) {
    if (e instanceof Response) {
      console.warn(`[gifts] webhook rejected: ${e.status} ${request.headers.get("x-shopify-topic")}`);
      return e;
    }
    console.error("[gifts] webhook auth error", e);
    return new Response("Error", { status: 500 });
  }
  const { shop, payload } = auth;
  const p = payload as { admin_graphql_api_id?: string; id?: number | string; name?: string };
  const orderId = p?.admin_graphql_api_id || (p?.id ? `gid://shopify/Order/${p.id}` : "");
  if (orderId) {
    void queueIncludedOrder(shop, orderId, String(p?.name || "")).catch((e) =>
      console.error("[gifts] included parts queue failed", e),
    );
  }
  return new Response();
};
