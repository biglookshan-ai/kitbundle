import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

// Discount status/repair moved into Settings. Keep this path as a redirect so
// old links/bookmarks still work.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  void request;
  return redirect("/app/settings");
};
