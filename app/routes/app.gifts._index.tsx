import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  ButtonGroup,
  Badge,
  Box,
  Banner,
  Thumbnail,
  Icon,
  EmptyState,
} from "@shopify/polaris";
import {
  ImageIcon,
  CollectionIcon,
  ArrowRightIcon,
  SearchIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  listCampaigns,
  deleteCampaign,
  resyncAll,
} from "../models/gift-campaign.server";
import { campaignState, type Ref } from "../models/gift-campaign";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaigns = await listCampaigns(session.shop);
  return { campaigns };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "delete") {
    const id = String(form.get("id") || "");
    const r = await deleteCampaign(admin, session.shop, id);
    return { ok: r.ok, error: r.errors.join("; ") || null, message: null };
  }
  if (intent === "resync") {
    const r = await resyncAll(admin, session.shop);
    return {
      ok: r.ok,
      error: r.errors.join("; ") || null,
      message: r.ok ? "Trigger products re-synced." : null,
    };
  }
  return { ok: false, error: "Unknown action", message: null };
};

const STATE_TONE: Record<string, "success" | "info" | "attention" | undefined> =
  {
    active: "success",
    scheduled: "info",
    ended: "attention",
    disabled: undefined,
  };

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One labelled column of product/collection chips (with thumbnails). */
function RefColumn({
  label,
  products,
  collections = [],
  tone,
  emptyText,
}: {
  label: string;
  products: Ref[];
  collections?: Ref[];
  tone?: "success";
  emptyText?: string;
}) {
  const total = products.length + collections.length;
  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodyXs" tone="subdued">
        {label} ({total})
      </Text>
      {total === 0 ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {emptyText || "—"}
        </Text>
      ) : (
        <InlineStack gap="150" wrap>
          {collections.map((c) => (
            <Box
              key={c.id}
              background="bg-surface-secondary"
              padding="100"
              borderRadius="200"
            >
              <InlineStack gap="100" blockAlign="center" wrap={false}>
                <Icon source={CollectionIcon} tone="subdued" />
                <Text as="span" variant="bodySm">
                  {c.title || "Collection"}
                </Text>
              </InlineStack>
            </Box>
          ))}
          {products.map((p) => (
            <Box
              key={p.id}
              background={tone === "success" ? "bg-surface-success" : "bg-surface-secondary"}
              padding="100"
              borderRadius="200"
            >
              <InlineStack gap="100" blockAlign="center" wrap={false}>
                <Thumbnail
                  source={p.image || ImageIcon}
                  alt={p.title}
                  size="extraSmall"
                />
                <Text as="span" variant="bodySm">
                  {p.title || p.handle}
                </Text>
              </InlineStack>
            </Box>
          ))}
        </InlineStack>
      )}
    </BlockStack>
  );
}

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "scheduled", label: "Scheduled" },
  { key: "ended", label: "Ended" },
];

export default function GiftCampaigns() {
  const { campaigns } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const busy = fetcher.state !== "idle";

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState<"simple" | "detailed">("simple");

  const q = query.trim().toLowerCase();
  const visible = campaigns.filter((c) => {
    if (status !== "all" && campaignState(c) !== status) return false;
    if (!q) return true;
    const hay = [
      c.title,
      ...c.triggerProducts.map((p) => p.title),
      ...c.triggerCollections.map((p) => p.title),
      ...c.giftProducts.map((p) => p.title),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  return (
    <Page>
      <TitleBar title="Free gifts" />
      <BlockStack gap="400">
        {fetcher.data?.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}
        {fetcher.data?.message && (
          <Banner tone="success">{fetcher.data.message}</Banner>
        )}

        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Free gift offers
          </Text>
          <InlineStack gap="200">
            <Button
              loading={busy}
              onClick={() =>
                fetcher.submit({ intent: "resync" }, { method: "POST" })
              }
            >
              Re-sync collections
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate("/app/gifts/new")}
            >
              New campaign
            </Button>
          </InlineStack>
        </InlineStack>

        {campaigns.length > 0 && (
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <Box minWidth="260px">
              <TextField
                label="Search"
                labelHidden
                value={query}
                onChange={setQuery}
                autoComplete="off"
                placeholder="Search by campaign, trigger or gift"
                prefix={<Icon source={SearchIcon} />}
                clearButton
                onClearButtonClick={() => setQuery("")}
              />
            </Box>
            <InlineStack gap="200" blockAlign="center">
              <ButtonGroup variant="segmented">
                {STATUS_FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    pressed={status === f.key}
                    onClick={() => setStatus(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </ButtonGroup>
              <ButtonGroup variant="segmented">
                <Button
                  pressed={mode === "simple"}
                  onClick={() => setMode("simple")}
                >
                  Simple
                </Button>
                <Button
                  pressed={mode === "detailed"}
                  onClick={() => setMode("detailed")}
                >
                  Detailed
                </Button>
              </ButtonGroup>
            </InlineStack>
          </InlineStack>
        )}

        {campaigns.length === 0 ? (
          <Card>
            <EmptyState
              heading="No gift campaigns yet"
              action={{
                content: "New campaign",
                onAction: () => navigate("/app/gifts/new"),
              }}
              image=""
            >
              <p>
                Reward customers with a free gift when they buy chosen products
                or collections — buy 2, get 2.
              </p>
            </EmptyState>
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <Box padding="400">
              <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                No campaigns match your search.
              </Text>
            </Box>
          </Card>
        ) : (
          <Card padding="0">
            <BlockStack>
              {visible.map((c, i) => {
                const state = campaignState(c);
                const meta = [
                  `Buy 1 → get ${c.perQualifying} free`,
                  c.rewardMode === "choice"
                    ? "customer picks a gift"
                    : "gift auto-added",
                  c.endsAt ? `ends ${fmtDate(c.endsAt)}` : null,
                  c.startsAt && state === "scheduled"
                    ? `starts ${fmtDate(c.startsAt)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Box
                    key={c.id}
                    padding="400"
                    borderBlockEndWidth={
                      i < visible.length - 1 ? "025" : undefined
                    }
                    borderColor="border"
                  >
                    <BlockStack gap="300">
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        wrap={false}
                      >
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text
                              as="span"
                              variant="bodyMd"
                              fontWeight="medium"
                            >
                              {c.title || "Untitled campaign"}
                            </Text>
                            <Badge tone={STATE_TONE[state]}>{state}</Badge>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {meta}
                          </Text>
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button onClick={() => navigate(`/app/gifts/${c.id}`)}>
                            Edit
                          </Button>
                          <Button
                            tone="critical"
                            variant="tertiary"
                            loading={busy}
                            onClick={() =>
                              fetcher.submit(
                                { intent: "delete", id: c.id },
                                { method: "POST" },
                              )
                            }
                          >
                            Delete
                          </Button>
                        </InlineStack>
                      </InlineStack>

                      {/* triggers → gifts (one/many-to-many) — detailed only */}
                      {mode === "detailed" && (
                        <Box
                          background="bg-surface-secondary"
                          padding="300"
                          borderRadius="200"
                        >
                          <InlineStack
                            gap="300"
                            blockAlign="start"
                            wrap={false}
                            align="start"
                          >
                            <Box width="45%">
                              <RefColumn
                                label="Buy any of"
                                products={c.triggerProducts}
                                collections={c.triggerCollections}
                                emptyText="No trigger set"
                              />
                            </Box>
                            <Box>
                              <Icon source={ArrowRightIcon} tone="subdued" />
                            </Box>
                            <Box width="45%">
                              <RefColumn
                                label="Get free"
                                products={c.giftProducts}
                                tone="success"
                                emptyText="No gift set"
                              />
                            </Box>
                          </InlineStack>
                        </Box>
                      )}
                    </BlockStack>
                  </Box>
                );
              })}
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
