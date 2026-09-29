/**
 * Gifts module — shared admin UI: section tabs, campaign badges, index bar.
 */
import { useFetcher, useLocation, useNavigate } from "@remix-run/react";
import {
  Badge,
  Button,
  ButtonGroup,
  InlineStack,
  Link,
  Text,
} from "@shopify/polaris";
import type { CampaignMeta } from "./views.server";

const TABS = [
  { label: "Campaigns", to: "/app/gifts" },
  { label: "Products", to: "/app/gifts/products" },
  { label: "Gifts", to: "/app/gifts/items" },
  { label: "Brands", to: "/app/gifts/brands" },
];

/** The Gifts section's own navigation (separate from the bundle screens). */
export function GiftsNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active =
    TABS.slice(1).find((t) => pathname.startsWith(t.to))?.to ?? "/app/gifts";
  return (
    <ButtonGroup variant="segmented">
      {TABS.map((t) => (
        <Button
          key={t.to}
          pressed={active === t.to}
          onClick={() => navigate(t.to)}
        >
          {t.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

export const STATE_TONE: Record<
  CampaignMeta["state"],
  "success" | "info" | "attention" | undefined
> = {
  active: "success",
  scheduled: "info",
  ended: "attention",
  disabled: undefined,
};

export const STATE_LABEL: Record<CampaignMeta["state"], string> = {
  active: "Active",
  scheduled: "Scheduled",
  ended: "Ended",
  disabled: "Disabled",
};

/** Campaign chips, coloured by state; each opens the campaign editor. */
export function CampaignBadges({ campaigns }: { campaigns: CampaignMeta[] }) {
  const navigate = useNavigate();
  if (!campaigns.length) {
    return (
      <Text as="span" tone="subdued">
        —
      </Text>
    );
  }
  return (
    <InlineStack gap="100" wrap>
      {campaigns.map((c) => (
        <Link
          key={c.id}
          removeUnderline
          monochrome
          onClick={() => navigate(`/app/gifts/${c.id}`)}
        >
          <Badge tone={STATE_TONE[c.state]}>
            {`${c.title} · ${STATE_LABEL[c.state]}`}
          </Badge>
        </Link>
      ))}
    </InlineStack>
  );
}

/** Open a product in the Shopify admin (App Bridge handles `shopify:`). */
export function openProductInAdmin(numericId: string) {
  window.open(`shopify:admin/products/${numericId}`, "_top");
}

/** "Index updated …" + a Rebuild button (posts to /app/gifts/rebuild). */
export function IndexBar({ updatedAt }: { updatedAt: string | null }) {
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>();
  const busy = fetcher.state !== "idle";
  const when = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";
  return (
    <InlineStack gap="200" blockAlign="center">
      <Text as="span" variant="bodySm" tone="subdued">
        {fetcher.data?.message ||
          fetcher.data?.error ||
          `Index updated ${when}`}
      </Text>
      <Button
        size="slim"
        loading={busy}
        onClick={() =>
          fetcher.submit({}, { method: "POST", action: "/app/gifts/rebuild" })
        }
      >
        Rebuild
      </Button>
    </InlineStack>
  );
}
