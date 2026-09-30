import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { stockAndPrice } from "../modules/gifts/stock.server";

/** GET ?ids=gid,gid… → live stock per location + price (rows on screen). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const ids = (new URL(request.url).searchParams.get("ids") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!ids.length) return { stock: {}, price: {}, needsAccess: false };
  return stockAndPrice(admin, ids);
};
