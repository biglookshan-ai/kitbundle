/**
 * Gifts module — shared admin UI (kb kit): section frame, campaign pills,
 * index status bar.
 */
import { useEffect, type ReactNode } from "react";
import { useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Shell, Pill, Btn, type TabItem } from "../../ui/kit";
import type { CampaignMeta } from "./views.server";

export const GIFT_TABS: TabItem[] = [
  { label: "Campaigns", to: "/app/gifts" },
  { label: "Products", to: "/app/gifts/products" },
  { label: "Gifts", to: "/app/gifts/items" },
  { label: "Brands", to: "/app/gifts/brands" },
];

/** Frame for every Gifts page: KitBundle · Free gifts + the section tabs. */
export function GiftsShell({ children }: { children: ReactNode }) {
  return (
    <Shell section="Free gifts" tabs={GIFT_TABS}>
      {children}
    </Shell>
  );
}

export const STATE_TONE: Record<
  CampaignMeta["state"],
  "ok" | "info" | "warn" | undefined
> = {
  active: "ok",
  scheduled: "info",
  ended: "warn",
  disabled: undefined,
};

export const STATE_LABEL: Record<CampaignMeta["state"], string> = {
  active: "Active",
  scheduled: "Scheduled",
  ended: "Ended",
  disabled: "Disabled",
};

/** Campaign pills, coloured by state; each opens the campaign editor. */
export function CampaignPills({ campaigns }: { campaigns: CampaignMeta[] }) {
  if (!campaigns.length) return <span className="kb-muted">—</span>;
  return (
    <div className="kb-pills">
      {campaigns.map((c) => (
        <Pill key={c.id} tone={STATE_TONE[c.state]} to={`/app/gifts/${c.id}`}>
          {c.title}
          {c.state !== "active" ? ` · ${STATE_LABEL[c.state]}` : ""}
        </Pill>
      ))}
    </div>
  );
}

/** Open a product in the Shopify admin (App Bridge handles `shopify:`). */
export function openProductInAdmin(numericId: string) {
  window.open(`shopify:admin/products/${numericId}`, "_top");
}

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Re-sync" button (full gift sync); reports the result as an admin toast. */
export function RebuildButton() {
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>();
  const shopify = useAppBridge();
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    shopify.toast.show(d.ok ? d.message || "Synced" : d.error || "Sync failed", {
      isError: !d.ok,
    });
  }, [fetcher.state, fetcher.data, shopify]);
  return (
    <Btn
      loading={fetcher.state !== "idle"}
      onClick={() =>
        fetcher.submit({}, { method: "POST", action: "/app/gifts/rebuild" })
      }
    >
      Re-sync
    </Btn>
  );
}
