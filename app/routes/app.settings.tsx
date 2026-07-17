import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  List,
  Icon,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertTriangleIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ensureFunctionDiscount,
  findDiscountFunctionId,
  findExistingDiscount,
} from "../models/function-discount.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  await ensureFunctionDiscount(admin).catch(() => {}); // self-heal
  const [functionId, existing] = await Promise.all([
    findDiscountFunctionId(admin),
    findExistingDiscount(admin),
  ]);
  return {
    functionId,
    activated: Boolean(existing),
    status: existing?.status ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  return await ensureFunctionDiscount(admin);
};

export default function Settings() {
  const { functionId, activated, status } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const active = activated || fetcher.data?.ok;

  return (
    <Page>
      <TitleBar title="Settings" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Discount status */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon
                      source={active ? CheckCircleIcon : AlertTriangleIcon}
                      tone={active ? "success" : "warning"}
                    />
                    <Text as="h2" variant="headingMd">
                      Automatic discount
                    </Text>
                  </InlineStack>
                  {active ? (
                    <Badge tone="success">
                      {status === "ACTIVE" || fetcher.data?.ok
                        ? "Active"
                        : "Created"}
                    </Badge>
                  ) : (
                    <Badge tone="attention">Not active</Badge>
                  )}
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  A single Shopify Function discount applies all your bundle,
                  add-on and free-gift pricing automatically at checkout — no
                  codes, no manual work. It activates itself; this is only here to
                  repair it if it was ever deleted.
                </Text>

                {fetcher.data?.error && (
                  <Banner tone="critical" title="Could not activate">
                    <p>{fetcher.data.error}</p>
                  </Banner>
                )}
                {!functionId && !active && (
                  <Banner tone="warning" title="Function not deployed">
                    <p>
                      Reinstall the app or contact support if this persists.
                    </p>
                  </Banner>
                )}

                {!active && (
                  <InlineStack>
                    <Button
                      variant="primary"
                      loading={busy}
                      onClick={() => fetcher.submit({}, { method: "POST" })}
                    >
                      Re-activate discount
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            {/* Storefront block */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Storefront block
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Your offers appear through the <b>KitBundle</b> app block. Add
                  it once to your product template:
                </Text>
                <List type="number">
                  <List.Item>
                    Online Store → Themes → Customize.
                  </List.Item>
                  <List.Item>
                    Open a <b>Product</b> template, click Add block, choose{" "}
                    <b>KitBundle — Bundle &amp; Add-ons</b>.
                  </List.Item>
                  <List.Item>
                    Position it where you want, adjust its colors and headings in
                    the block settings, and Save.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Support
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Questions or setup help — we usually reply within a day.
              </Text>
              <InlineStack>
                <Button url="mailto:biglookshan@gmail.com" external variant="plain">
                  biglookshan@gmail.com
                </Button>
              </InlineStack>
              <Button url="/privacy" external variant="plain">
                Privacy policy
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
