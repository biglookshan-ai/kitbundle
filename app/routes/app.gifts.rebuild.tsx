import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rebuildCoverage } from "../modules/gifts/coverage.server";

/** Full re-sync of gift stamps + the coverage index (the views' Re-sync button). */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const r = await rebuildCoverage(admin, session.shop);
    if (r.errors.length) return { ok: false, error: r.errors.join("; ") };
    return {
      ok: true,
      message: `Synced · ${r.scanned} products checked, ${r.changed} updated`,
    };
  } catch (e: any) {
    return { ok: false, error: `Sync failed: ${e?.message || e}` };
  }
};
