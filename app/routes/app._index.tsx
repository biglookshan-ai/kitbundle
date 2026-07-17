import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  InlineGrid,
  Badge,
  Box,
  Banner,
  Icon,
  List,
  Thumbnail,
} from "@shopify/polaris";
import {
  ImageIcon,
  ProductIcon,
  PackageIcon,
  PlusCircleIcon,
  GiftCardIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import { ensureFunctionDiscount } from "../models/function-discount.server";
import { listCampaigns } from "../models/gift-campaign.server";
import { useConfigureProduct } from "../components/OfferList";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Self-heal the activation discount on every dashboard load (idempotent).
  const [overview, ensured, campaigns] = await Promise.all([
    buildOffersOverview(admin, session.shop),
    ensureFunctionDiscount(admin).catch(() => ({ ok: false })),
    listCampaigns(session.shop).catch(() => []),
  ]);
  return {
    products: overview.products,
    stats: overview.stats,
    campaignCount: campaigns.filter((c) => c.enabled).length,
    discountActive: ensured.ok,
  };
};

function StatTile({
  icon,
  label,
  value,
  onClick,
}: {
  icon: any;
  label: string;
  value: number;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <Card>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <Box
            background="bg-surface-secondary"
            padding="200"
            borderRadius="200"
          >
            <Icon source={icon} tone="subdued" />
          </Box>
          <BlockStack gap="050">
            <Text as="p" variant="headingLg">
              {value}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {label}
            </Text>
          </BlockStack>
        </InlineStack>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { products, stats, campaignCount, discountActive } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const configure = useConfigureProduct();
  const isEmpty = stats.products === 0 && campaignCount === 0;

  return (
    <Page>
      <TitleBar title="KitBundle">
        <button variant="primary" onClick={configure}>
          Configure a product
        </button>
      </TitleBar>
      <BlockStack gap="500">
        {!discountActive && (
          <Banner
            tone="warning"
            title="Discounts are not active"
            action={{ content: "Fix it", url: "/app/settings" }}
          >
            <p>
              The automatic discount that powers your offers is missing. Offers
              will show at full price until it is restored.
            </p>
          </Banner>
        )}

        {/* Stat tiles */}
        <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
          <StatTile
            icon={ProductIcon}
            label="Products"
            value={stats.products}
            onClick={() => navigate("/app/bundles")}
          />
          <StatTile
            icon={PackageIcon}
            label="Bundles"
            value={stats.bundle + stats.sale}
            onClick={() => navigate("/app/bundles")}
          />
          <StatTile
            icon={PlusCircleIcon}
            label="Add-ons"
            value={stats.addon + stats.free}
            onClick={() => navigate("/app/addons")}
          />
          <StatTile
            icon={GiftCardIcon}
            label="Gift campaigns"
            value={campaignCount}
            onClick={() => navigate("/app/gifts")}
          />
        </InlineGrid>

        <Layout>
          <Layout.Section>
            {isEmpty ? (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Get started in 3 steps
                  </Text>
                  <List type="number">
                    <List.Item>
                      Click <b>Configure a product</b> and pick a main product.
                    </List.Item>
                    <List.Item>
                      Add a bundle, add-on or free gift with a discount, then
                      Save.
                    </List.Item>
                    <List.Item>
                      In your theme editor, add the <b>KitBundle</b> block to the
                      product template.
                    </List.Item>
                  </List>
                  <InlineStack>
                    <Button variant="primary" onClick={configure}>
                      Configure a product
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ) : (
              <Card padding="0">
                <Box
                  padding="300"
                  borderBlockEndWidth="025"
                  borderColor="border"
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingSm">
                      Configured products
                    </Text>
                    <Button variant="plain" onClick={() => navigate("/app/bundles")}>
                      View all
                    </Button>
                  </InlineStack>
                </Box>
                <BlockStack>
                  {products.slice(0, 6).map((p, i) => (
                    <Box
                      key={p.id}
                      padding="300"
                      borderBlockEndWidth={i < Math.min(products.length, 6) - 1 ? "025" : undefined}
                      borderColor="border"
                    >
                      <InlineStack align="space-between" blockAlign="center" wrap={false}>
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <Thumbnail source={p.image || ImageIcon} alt={p.title} size="small" />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="medium">
                              {p.title}
                            </Text>
                            <InlineStack gap="150" wrap>
                              {p.counts.bundle + p.counts.sale > 0 && (
                                <Badge tone="info">{`${p.counts.bundle + p.counts.sale} bundle`}</Badge>
                              )}
                              {p.counts.addon > 0 && <Badge>{`${p.counts.addon} add-on`}</Badge>}
                              {p.counts.free > 0 && <Badge tone="success">{`${p.counts.free} free`}</Badge>}
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>
                        <Button onClick={() => navigate(`/app/products/${p.numericId}`)}>
                          Edit
                        </Button>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              </Card>
            )}
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <InlineStack gap="150" blockAlign="center">
                    <Icon
                      source={CheckCircleIcon}
                      tone={discountActive ? "success" : "subdued"}
                    />
                    <Text as="h3" variant="headingSm">
                      Status
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {discountActive
                      ? "Automatic discounts are active. Your offers apply at checkout with no codes."
                      : "Automatic discounts are not active yet."}
                  </Text>
                  <InlineStack>
                    <Button onClick={() => navigate("/app/settings")}>
                      Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    What&apos;s new
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    • Multi-bundle picker on the product page
                    <br />• Free while in early access
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Need help?
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Email us and we&apos;ll help you set up your first offer.
                  </Text>
                  <InlineStack>
                    <Button
                      url="mailto:biglookshan@gmail.com"
                      external
                      variant="plain"
                    >
                      biglookshan@gmail.com
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
