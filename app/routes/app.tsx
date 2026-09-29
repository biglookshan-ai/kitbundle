import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect, type ReactNode } from "react";
import {
  Link,
  Outlet,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { NavMenu } from "@shopify/app-bridge-react";
import kbStyles from "../ui/kb.css?url";

import { authenticate, BILLING_ENABLED } from "../shopify.server";

// Every admin page uses the kb kit (app/ui) — no Polaris CSS/JS is loaded.
export const links = () => [{ rel: "stylesheet", href: kbStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    billingEnabled: BILLING_ENABLED,
  };
};

/**
 * What @shopify/shopify-app-remix's AppProvider does, minus the Polaris
 * provider it wraps (which would pull Polaris into every page): load App Bridge
 * and route its `shopify:navigate` events (NavMenu clicks) through Remix.
 */
function AppBridgeProvider({
  apiKey,
  children,
}: {
  apiKey: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const href = (event.target as HTMLElement | null)?.getAttribute("href");
      if (href) navigate(href);
    };
    addEventListener("shopify:navigate", onNavigate);
    return () => removeEventListener("shopify:navigate", onNavigate);
  }, [navigate]);
  return (
    <>
      <script
        src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
        data-api-key={apiKey}
      />
      {children}
    </>
  );
}

export default function App() {
  const { apiKey, billingEnabled } = useLoaderData<typeof loader>();

  return (
    <AppBridgeProvider apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/bundles">Bundles</Link>
        <Link to="/app/addons">Add-ons</Link>
        <Link to="/app/gifts">Free gifts</Link>
        <Link to="/app/settings">Settings</Link>
        {billingEnabled ? <Link to="/app/plan">Plan</Link> : null}
      </NavMenu>
      <Outlet />
    </AppBridgeProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
