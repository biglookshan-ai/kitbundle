import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  TextField,
  Select,
  Checkbox,
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
  return {
    products: views.products,
    campaigns: views.campaigns,
    updatedAt,
  };
};

const PAGE = 50;

function Stat({ label, value, tone }: { label: string; value: number; tone?: "critical" }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="span" variant="headingLg" tone={tone}>
          {String(value)}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function GiftProducts() {
  const { products, campaigns, updatedAt } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();

  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState(params.get("vendor") ?? "all");
  const [campaign, setCampaign] = useState(params.get("campaign") ?? "all");
  const [state, setState] = useState("any");
  const [overlapOnly, setOverlapOnly] = useState(false);
  const giftFilter = params.get("gift") ?? "";
  const [page, setPage] = useState(0);

  const vendors = useMemo(
    () =>
      [...new Set(products.map((p) => p.vendor || ""))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [products],
  );

  const q = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (vendor !== "all" && (p.vendor || "") !== vendor) return false;
    if (campaign !== "all" && !p.campaigns.some((c) => c.id === campaign))
      return false;
    if (giftFilter && !p.gifts.some((g) => g.productId.endsWith(`/${giftFilter}`)))
      return false;
    if (state === "active" && p.activeCampaigns === 0) return false;
    if (state === "inactive" && p.activeCampaigns > 0) return false;
    if (overlapOnly && p.activeCampaigns < 2) return false;
    if (!q) return true;
    return [p.title, p.vendor, p.productType, ...p.gifts.map((g) => g.title)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const giftName =
    giftFilter &&
    products
      .flatMap((p) => p.gifts)
      .find((g) => g.productId.endsWith(`/${giftFilter}`))?.title;

  const activeNow = products.filter((p) => p.activeCampaigns > 0).length;
  const overlaps = products.filter((p) => p.activeCampaigns > 1).length;

  return (
    <Page fullWidth>
      <TitleBar title="Free gifts" />
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <GiftsNav />
          <IndexBar updatedAt={updatedAt} />
        </InlineStack>

        <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
          <Stat label="Products with gifts" value={products.length} />
          <Stat label="Giving a gift now" value={activeNow} />
          <Stat label="Brands" value={vendors.length} />
          <Stat
            label="In 2+ active campaigns"
            value={overlaps}
            tone={overlaps ? "critical" : undefined}
          />
        </InlineGrid>

        <Card padding="0">
          <BlockStack>
            <div style={{ padding: 12 }}>
              <InlineStack gap="300" wrap blockAlign="end">
                <div style={{ minWidth: 240, flex: 1 }}>
                  <TextField
                    label="Search"
                    labelHidden
                    prefix={<SearchIcon width={16} />}
                    placeholder="Search products, brands or gifts"
                    value={query}
                    onChange={(v) => {
                      setQuery(v);
                      setPage(0);
                    }}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setQuery("")}
                  />
                </div>
                <Select
                  label="Brand"
                  labelInline
                  options={[
                    { label: "All brands", value: "all" },
                    ...vendors.map((v) => ({ label: v || "(No brand)", value: v })),
                  ]}
                  value={vendor}
                  onChange={(v) => {
                    setVendor(v);
                    setPage(0);
                  }}
                />
                <Select
                  label="Campaign"
                  labelInline
                  options={[
                    { label: "All campaigns", value: "all" },
                    ...campaigns.map((c) => ({ label: c.title, value: c.id })),
                  ]}
                  value={campaign}
                  onChange={(v) => {
                    setCampaign(v);
                    setPage(0);
                  }}
                />
                <Select
                  label="Status"
                  labelInline
                  options={[
                    { label: "Any", value: "any" },
                    { label: "Giving a gift now", value: "active" },
                    { label: "Not giving now", value: "inactive" },
                  ]}
                  value={state}
                  onChange={(v) => {
                    setState(v);
                    setPage(0);
                  }}
                />
                <Checkbox
                  label="Only overlaps"
                  checked={overlapOnly}
                  onChange={(v) => {
                    setOverlapOnly(v);
                    setPage(0);
                  }}
                />
              </InlineStack>
              {giftName ? (
                <div style={{ marginTop: 8 }}>
                  <Badge tone="info">{`Giving: ${giftName}`}</Badge>
                </div>
              ) : null}
            </div>

            {products.length === 0 ? (
              <EmptyState
                heading="No products give a gift yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Create a gift campaign and its trigger products will appear here.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={filtered.length}
                selectable={false}
                headings={[
                  { title: "Product" },
                  { title: "Brand" },
                  { title: "Gifts" },
                  { title: "Campaigns" },
                  { title: "How it's included" },
                ]}
                pagination={{
                  hasPrevious: page > 0,
                  hasNext: (page + 1) * PAGE < filtered.length,
                  onPrevious: () => setPage((p) => p - 1),
                  onNext: () => setPage((p) => p + 1),
                  label: `${filtered.length ? page * PAGE + 1 : 0}–${Math.min(
                    (page + 1) * PAGE,
                    filtered.length,
                  )} of ${filtered.length}`,
                }}
              >
                {pageRows.map((p, i) => (
                  <IndexTable.Row id={p.productId} key={p.productId} position={i}>
                    <IndexTable.Cell>
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <Thumbnail source={p.image || ImageIcon} alt="" size="small" />
                        <BlockStack gap="050">
                          <Link
                            removeUnderline
                            monochrome
                            onClick={() => openProductInAdmin(p.numericId)}
                          >
                            <Text as="span" fontWeight="semibold">
                              {p.title || p.handle}
                            </Text>
                          </Link>
                          <InlineStack gap="100">
                            {p.status && p.status !== "ACTIVE" ? (
                              <Badge tone={p.status === "DELETED" ? "critical" : "warning"}>
                                {p.status.toLowerCase()}
                              </Badge>
                            ) : null}
                            {p.activeCampaigns > 1 ? (
                              <Badge tone="critical">
                                {`${p.activeCampaigns} active campaigns`}
                              </Badge>
                            ) : null}
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">{p.vendor || "—"}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100" blockAlign="center" wrap={false}>
                        {p.gifts.slice(0, 4).map((g) => (
                          <Thumbnail
                            key={g.productId}
                            source={g.image || ImageIcon}
                            alt={g.title}
                            size="extraSmall"
                          />
                        ))}
                        <Text as="span" tone="subdued">
                          {p.gifts.length > 4
                            ? `+${p.gifts.length - 4}`
                            : `${p.gifts.length}`}
                        </Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <CampaignBadges campaigns={p.campaigns} />
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {p.via.join(" · ") || "—"}
                      </Text>
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
