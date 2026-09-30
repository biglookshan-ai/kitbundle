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
  { label: "Calendar", to: "/app/gifts/calendar" },
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
  paused: "warn",
  ended: undefined,
  draft: undefined,
};

export const STATE_LABEL: Record<CampaignMeta["state"], string> = {
  active: "Active",
  scheduled: "Scheduled",
  paused: "Paused",
  ended: "Ended",
  draft: "Draft",
};

/** "in 3 days" / "5 hours ago" — coarse, for schedules. */
export function fmtRelative(iso: string, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  const abs = Math.abs(ms);
  const unit =
    abs < 3_600_000
      ? { n: Math.max(1, Math.round(abs / 60_000)), u: "min" }
      : abs < 86_400_000 * 2
        ? { n: Math.round(abs / 3_600_000), u: "hour" }
        : { n: Math.round(abs / 86_400_000), u: "day" };
  const txt = `${unit.n} ${unit.u}${unit.n === 1 || unit.u === "min" ? "" : "s"}`;
  return ms >= 0 ? `in ${txt}` : `${txt} ago`;
}

/** Short schedule pill for the list: starts / ends within a week. */
export function timingHint(
  c: { startsAt: string; endsAt: string },
  state: CampaignMeta["state"],
): string | null {
  const week = 7 * 86_400_000;
  const soon = (iso: string) => iso && Math.abs(Date.parse(iso) - Date.now()) < week;
  if (state === "scheduled" && soon(c.startsAt)) return `Starts ${fmtRelative(c.startsAt)}`;
  if (state === "active" && soon(c.endsAt)) return `Ends ${fmtRelative(c.endsAt)}`;
  return null;
}

/** One sentence on where a campaign stands (editor Status panel). */
export function statusSentence(
  c: { startsAt: string; endsAt: string },
  state: CampaignMeta["state"],
): string {
  const at = (iso: string) => `${fmtWhen(iso)} (${fmtRelative(iso)})`;
  switch (state) {
    case "draft":
      return "Draft — not on the storefront. Choose Published to go live.";
    case "paused":
      return "Paused — not on the storefront until you publish it again.";
    case "scheduled":
      return `Starts ${at(c.startsAt)}${c.endsAt ? `, ends ${fmtWhen(c.endsAt)}` : ""}.`;
    case "ended":
      return `Ended ${at(c.endsAt)}.`;
    default:
      return c.endsAt ? `Live now — ends ${at(c.endsAt)}.` : "Live now — no end date.";
  }
}

/** Campaign pills, coloured by state; each opens the campaign editor. */
export function CampaignPills({ campaigns }: { campaigns: CampaignMeta[] }) {
  if (!campaigns.length) return <span className="kb-muted">—</span>;
  return (
    <div className="kb-pills">
      {campaigns.map((c) => (
        <Pill
          key={c.id}
          tone={c.blocked ? undefined : STATE_TONE[c.state]}
          to={`/app/gifts/${c.id}`}
          title={
            c.blocked
              ? "Not given on this product — another campaign wins the overlap (priority / exclusive)."
              : undefined
          }
        >
          {c.title}
          {c.blocked
            ? " · Not given"
            : c.state !== "active"
              ? ` · ${STATE_LABEL[c.state]}`
              : ""}
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
