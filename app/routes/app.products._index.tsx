import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  Box,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Badge,
  Thumbnail,
  Icon,
} from "@shopify/polaris";
import { ImageIcon, SearchIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import { OfferEmpty, useConfigureProduct } from "../components/OfferList";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { products } = await buildOffersOverview(admin, session.shop);
  return { products };
};

export default function ProductsIndex() {
  const { products } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const configure = useConfigureProduct();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = products.filter(
    (p) => !q || p.title.toLowerCase().includes(q),
  );

  return (
    <Page>
      <TitleBar title="Products">
        <button variant="primary" onClick={configure}>
          Configure a product
        </button>
      </TitleBar>

      {products.length === 0 ? (
        <OfferEmpty
          heading="No products configured yet"
          body="Pick a product to start building bundles, add-ons and offers on it. Everything you create is also listed by type under Bundles, Add-ons and Free gifts."
          onConfigure={configure}
        />
      ) : (
        <BlockStack gap="400">
          <Box>
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Box minWidth="260px">
                <TextField
                  label="Search"
                  labelHidden
                  value={query}
                  onChange={setQuery}
                  autoComplete="off"
                  placeholder="Search products"
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => setQuery("")}
                />
              </Box>
              <Text as="span" variant="bodySm" tone="subdued">
                {products.length} configured{" "}
                {products.length === 1 ? "product" : "products"}
              </Text>
            </InlineStack>
          </Box>

          {visible.length === 0 ? (
            <Card>
              <Box padding="400">
                <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                  No products match “{query}”.
                </Text>
              </Box>
            </Card>
          ) : (
            <Card padding="0">
              <BlockStack>
                {visible.map((p, i) => (
                  <Box
                    key={p.id}
                    padding="300"
                    borderBlockEndWidth={
                      i < visible.length - 1 ? "025" : undefined
                    }
                    borderColor="border"
                  >
                    <InlineStack
                      align="space-between"
                      blockAlign="center"
                      wrap={false}
                    >
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <Thumbnail
                          source={p.image || ImageIcon}
                          alt={p.title}
                          size="small"
                        />
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="medium">
                            {p.title}
                          </Text>
                          <InlineStack gap="150" wrap>
                            {p.counts.bundle > 0 && (
                              <Badge tone="info">{`${p.counts.bundle} bundle`}</Badge>
                            )}
                            {p.counts.sale > 0 && (
                              <Badge tone="attention">{`${p.counts.sale} sale`}</Badge>
                            )}
                            {p.counts.addon > 0 && (
                              <Badge>{`${p.counts.addon} add-on`}</Badge>
                            )}
                            {p.counts.free > 0 && (
                              <Badge tone="success">{`${p.counts.free} free`}</Badge>
                            )}
                            {p.counts.bundle +
                              p.counts.sale +
                              p.counts.addon +
                              p.counts.free ===
                              0 && (
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                              >
                                No active offers
                              </Text>
                            )}
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>
                      <Button
                        onClick={() =>
                          navigate(`/app/products/${p.numericId}`)
                        }
                      >
                        Manage
                      </Button>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      )}
    </Page>
  );
}
