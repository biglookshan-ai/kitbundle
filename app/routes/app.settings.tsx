import { useState } from "react";
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
  Checkbox,
  TextField,
  Box,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertTriangleIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ensureFunctionDiscount,
  findDiscountFunctionId,
  findExistingDiscount,
} from "../models/function-discount.server";
import {
  getShopSettings,
  saveShopSettings,
} from "../models/shop-settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureFunctionDiscount(admin).catch(() => {}); // self-heal
  const [functionId, existing, settings] = await Promise.all([
    findDiscountFunctionId(admin),
    findExistingDiscount(admin),
    getShopSettings(session.shop),
  ]);
  return {
    functionId,
    activated: Boolean(existing),
    status: existing?.status ?? null,
    settings,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "activate");
  if (intent === "settings") {
    const settings = await saveShopSettings(session.shop, {
      tagOffers: form.get("tagOffers") === "true",
      offerTag: String(form.get("offerTag") || "kitbundle"),
    });
    return { ok: true, settings };
  }
  return await ensureFunctionDiscount(admin);
};

export default function Settings() {
  const { functionId, activated, status, settings } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const settingsFetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const active = activated || fetcher.data?.ok;

  const [tagOffers, setTagOffers] = useState(settings.tagOffers);
  const [offerTag, setOfferTag] = useState(settings.offerTag);
  const savingSettings = settingsFetcher.state !== "idle";
  const savedSettings = settingsFetcher.data?.ok;

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

                {(fetcher.data as any)?.error && (
                  <Banner tone="critical" title="Could not activate">
                    <p>{(fetcher.data as any).error}</p>
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

            {/* Search & discovery tag */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Search &amp; discovery tag
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add a product tag to every product that has a live offer, so
                  you can find bundled products in Shopify search, build automated
                  collections, or feed a custom search engine. Only KitBundle&apos;s
                  own tag is added or removed — your other tags are untouched.
                </Text>
                <Checkbox
                  label="Tag products that have a live offer"
                  checked={tagOffers}
                  onChange={setTagOffers}
                />
                <Box width="240px">
                  <TextField
                    label="Tag"
                    autoComplete="off"
                    value={offerTag}
                    onChange={setOfferTag}
                    disabled={!tagOffers}
                    helpText="Lowercase, no spaces (e.g. kitbundle, has-bundle)."
                  />
                </Box>
                <InlineStack gap="200" blockAlign="center">
                  <Button
                    loading={savingSettings}
                    onClick={() =>
                      settingsFetcher.submit(
                        {
                          intent: "settings",
                          tagOffers: String(tagOffers),
                          offerTag,
                        },
                        { method: "POST" },
                      )
                    }
                  >
                    Save
                  </Button>
                  {savedSettings && (
                    <Text as="span" tone="success" variant="bodySm">
                      Saved. Re-save a product to apply the tag.
                    </Text>
                  )}
                </InlineStack>
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
