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
  IndexTable,
  Link,
  EmptyState,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ensureCoverage,
  coverageUpdatedAt,
} from "../modules/gifts/coverage.server";
import { buildGiftViews } from "../modules/gifts/views.server";
import { GiftsNav, CampaignBadges, IndexBar } from "../modules/gifts/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureCoverage(admin, session.shop);
  const [views, updatedAt] = await Promise.all([
    buildGiftViews(session.shop),
    coverageUpdatedAt(session.shop),
  ]);
  return { brands: views.brands, updatedAt };
};

export default function GiftBrands() {
  const { brands, updatedAt } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = brands.filter(
    (b) => !q || (b.vendor || "(no brand)").toLowerCase().includes(q),
  );

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
              <TextField
                label="Search"
                labelHidden
                prefix={<SearchIcon width={16} />}
                placeholder="Search brands"
                value={query}
                onChange={setQuery}
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setQuery("")}
              />
            </div>
            {brands.length === 0 ? (
              <EmptyState
                heading="No brands yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Brands appear once their products are part of a gift campaign.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "brand", plural: "brands" }}
                itemCount={visible.length}
                selectable={false}
                headings={[
                  { title: "Brand" },
                  { title: "Products with gifts" },
                  { title: "Distinct gifts" },
                  { title: "Campaigns" },
                ]}
              >
                {visible.map((b, i) => (
                  <IndexTable.Row id={b.vendor || "_none"} key={b.vendor || "_none"} position={i}>
                    <IndexTable.Cell>
                      <Link
                        removeUnderline
                        onClick={() =>
                          navigate(
                            `/app/gifts/products?vendor=${encodeURIComponent(b.vendor)}`,
                          )
                        }
                      >
                        <Text as="span" fontWeight="semibold">
                          {b.vendor || "(No brand)"}
                        </Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span">{String(b.productCount)}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {`${b.activeProductCount} giving now`}
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">{String(b.giftCount)}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <CampaignBadges campaigns={b.campaigns} />
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
