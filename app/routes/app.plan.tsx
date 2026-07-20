import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  List,
  Banner,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  authenticate,
  PRO_PLAN,
  BILLING_TEST,
  BILLING_ENABLED,
} from "../shopify.server";
import { FREE_PRODUCT_LIMIT, FREE_CAMPAIGN_LIMIT } from "../models/plan";
import { isFreeShop } from "../models/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  if (!BILLING_ENABLED) throw redirect("/app"); // free launch → no plan page
  const comped = isFreeShop(session.shop);
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [PRO_PLAN],
    isTest: BILLING_TEST,
  });
  const sub = appSubscriptions?.[0] ?? null;
  return {
    pro: hasActivePayment,
    comped,
    subName: sub?.name ?? null,
    test: BILLING_TEST,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "upgrade");

  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN],
      isTest: BILLING_TEST,
    });
    const sub = appSubscriptions?.[0];
    if (sub) {
      await billing.cancel({
        subscriptionId: sub.id,
        isTest: BILLING_TEST,
        prorate: true,
      });
    }
    return { ok: true };
  }

  // Upgrade: redirects the merchant to Shopify's subscription confirmation.
  await billing.request({
    plan: PRO_PLAN,
    isTest: BILLING_TEST,
    returnUrl: `https://${session.shop}/admin/apps`,
  });
  return { ok: true };
};

export default function Plan() {
  const { pro, comped, test } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <Page>
      <TitleBar title="Plan" />
      <Layout>
        <Layout.Section>
          {comped && (
            <Box paddingBlockEnd="400">
              <Banner tone="success" title="Complimentary access">
                This store has full access to all features at no charge. No
                subscription needed.
              </Banner>
            </Box>
          )}
          {test && (
            <Box paddingBlockEnd="400">
              <Banner tone="info">
                Billing is in TEST mode — no real charges. (Disable
                SHOPIFY_BILLING_TEST before launch.)
              </Banner>
            </Box>
          )}
          <InlineStack gap="400" align="start" blockAlign="stretch" wrap>
            <Box width="320px">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Free
                    </Text>
                    {!pro && <Badge tone="success">Current plan</Badge>}
                  </InlineStack>
                  <Text as="p" variant="heading2xl">
                    $0
                  </Text>
                  <List>
                    <List.Item>
                      {FREE_PRODUCT_LIMIT} product with bundles &amp; add-ons
                    </List.Item>
                    <List.Item>
                      {FREE_CAMPAIGN_LIMIT} gift campaign
                    </List.Item>
                    <List.Item>All offer types included</List.Item>
                    <List.Item>Automatic Function-based discounts</List.Item>
                  </List>
                </BlockStack>
              </Card>
            </Box>
            <Box width="320px">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Pro
                    </Text>
                    {pro && <Badge tone="success">Current plan</Badge>}
                  </InlineStack>
                  <InlineStack gap="100" blockAlign="end">
                    <Text as="p" variant="heading2xl">
                      $29
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      / month
                    </Text>
                  </InlineStack>
                  <List>
                    <List.Item>Unlimited products</List.Item>
                    <List.Item>Unlimited gift campaigns</List.Item>
                    <List.Item>Limited-time offers &amp; countdowns</List.Item>
                    <List.Item>Priority support</List.Item>
                  </List>
                  {pro ? (
                    <Button
                      tone="critical"
                      variant="secondary"
                      loading={busy}
                      onClick={() =>
                        fetcher.submit({ intent: "cancel" }, { method: "POST" })
                      }
                    >
                      Cancel subscription
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      loading={busy}
                      onClick={() =>
                        fetcher.submit({ intent: "upgrade" }, { method: "POST" })
                      }
                    >
                      Start 7-day free trial
                    </Button>
                  )}
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
