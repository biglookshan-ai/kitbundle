import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  IndexTable,
  Thumbnail,
  Badge,
  Link,
  EmptyState,
} from "@shopify/polaris";
import { ImageIcon, SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ensureCoverage,
  coverageUpdatedAt,
} from "../modules/gifts/coverage.server";
import { buildGiftViews } from "../modules/gifts/views.server";
import {
  GiftsNav,
  CampaignBadges,
  IndexBar,
  openProductInAdmin,
} from "../modules/gifts/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureCoverage(admin, session.shop);
  const [views, updatedAt] = await Promise.all([
    buildGiftViews(session.shop),
    coverageUpdatedAt(session.shop),
  ]);
  return { gifts: views.gifts, updatedAt };
};

/** Stock chip: out of stock / low / count / not tracked. */
function StockBadge({ qty }: { qty: number | null }) {
  if (qty === null) return <Badge>Not tracked</Badge>;
  if (qty <= 0) return <Badge tone="critical">Out of stock</Badge>;
  if (qty <= 5) return <Badge tone="warning">{`Low · ${qty}`}</Badge>;
  return <Badge tone="success">{`${qty} in stock`}</Badge>;
}

export default function GiftItems() {
  const { gifts, updatedAt } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [stock, setStock] = useState("all");

  const q = query.trim().toLowerCase();
  const visible = gifts.filter((g) => {
    if (stock === "risk" && !(g.totalInventory !== null && g.totalInventory <= 5))
      return false;
    if (stock === "active" && g.activeTriggerCount === 0) return false;
    if (!q) return true;
    return [g.title, g.vendor].join(" ").toLowerCase().includes(q);
  });

  return (
    <Page fullWidth>
      <TitleBar title="Free gifts" />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <GiftsNav />
          <IndexBar updatedAt={updatedAt} />
        </InlineStack>

        <Card padding="0">
          <BlockStack>
            <div style={{ padding: 12 }}>
              <InlineStack gap="300" wrap blockAlign="end">
                <div style={{ minWidth: 240, flex: 1 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    prefix={<SearchIcon width={16} />}
                    placeholder="Search gifts"
                    value={query}
                    onChange={setQuery}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setQuery("")}
                  />
                </div>
                <Select
                  label="Show"
                  labelInline
                  options={[
                    { label: "All gifts", value: "all" },
                    { label: "Being given now", value: "active" },
                    { label: "Low / out of stock", value: "risk" },
                  ]}
                  value={stock}
                  onChange={setStock}
                />
              </InlineStack>
            </div>

            {gifts.length === 0 ? (
              <EmptyState
                heading="No gifts configured yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Gift products from your campaigns will appear here.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "gift", plural: "gifts" }}
                itemCount={visible.length}
                selectable={false}
                headings={[
                  { title: "Gift" },
                  { title: "Stock" },
                  { title: "Given by" },
                  { title: "Campaigns" },
                ]}
              >
                {visible.map((g, i) => (
                  <IndexTable.Row id={g.productId} key={g.productId} position={i}>
                    <IndexTable.Cell>
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <Thumbnail source={g.image || ImageIcon} alt="" size="small" />
                        <BlockStack gap="050">
                          <Link
                            removeUnderline
                            monochrome
                            onClick={() => openProductInAdmin(g.numericId)}
                          >
                            <Text as="span" fontWeight="semibold">
                              {g.title}
                            </Text>
                          </Link>
                          <InlineStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {g.vendor || ""}
                            </Text>
                            {g.status && g.status !== "ACTIVE" ? (
                              <Badge tone={g.status === "DELETED" ? "critical" : "warning"}>
                                {g.status.toLowerCase()}
                              </Badge>
                            ) : null}
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <StockBadge qty={g.totalInventory} />
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Link
                          onClick={() =>
                            navigate(`/app/gifts/products?gift=${g.numericId}`)
                          }
                        >
                          {`${g.triggerCount} product${g.triggerCount === 1 ? "" : "s"}`}
                        </Link>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {`${g.activeTriggerCount} giving it now`}
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <CampaignBadges campaigns={g.campaigns} />
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
