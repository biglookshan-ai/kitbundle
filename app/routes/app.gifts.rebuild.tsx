import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rebuildCoverage } from "../modules/gifts/coverage.server";

/** Rebuild the whole gifts coverage index (used by the views' Rebuild button). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const r = await rebuildCoverage(admin, session.shop);
    return {
      ok: true,
      message: `Index rebuilt · ${r.triggers} product links and ${r.gifts} gifts across ${r.campaigns} campaigns`,
    };
  } catch (e: any) {
    return { ok: false, error: `Rebuild failed: ${e?.message || e}` };
  }
};
