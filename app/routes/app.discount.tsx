import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineStack,
  Badge,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

import {
  ensureFunctionDiscount,
  findDiscountFunctionId,
  findExistingDiscount,
} from "../models/function-discount.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  // Self-heal here too, so opening this page directly also activates it.
  await ensureFunctionDiscount(admin).catch(() => {});
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

export default function DiscountSettings() {
  const { functionId, activated, status } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const isWorking = fetcher.state !== "idle";
  const justActivated = fetcher.data?.ok;

  const isActive = activated || justActivated;

  return (
    <Page>
      <TitleBar title="Discount settings" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Automatic add-on discount
                </Text>
                {isActive ? (
                  <Badge tone="success">
                    {status === "ACTIVE" || justActivated ? "Active" : "Created"}
                  </Badge>
                ) : (
                  <Badge tone="attention">Not activated</Badge>
                )}
              </InlineStack>

              <Text as="p" variant="bodyMd">
                This single automatic discount powers every add-on group in the
                app. When a customer has a main product and one of its
                configured accessories in the cart, the discount Function applies
                the right percentage to the accessory — no codes, no manual work.
              </Text>

              {fetcher.data?.error && (
                <Banner tone="critical" title="Could not activate">
                  <p>{fetcher.data.error}</p>
                </Banner>
              )}

              {!functionId && !isActive && (
                <Banner tone="warning" title="Function not deployed yet">
                  <p>
                    Run <code>shopify app deploy</code> once so the discount
                    Function is registered, then reload this page.
                  </p>
                </Banner>
              )}

              {isActive ? (
                <Banner tone="success">
                  <p>
                    The automatic discount is in place. You don&apos;t need to do
                    anything else — configure products on the Home page.
                  </p>
                </Banner>
              ) : (
                <InlineStack>
                  <Button
                    variant="primary"
                    loading={isWorking}
                    disabled={!functionId}
                    onClick={() => fetcher.submit({}, { method: "POST" })}
                  >
                    Activate discount
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Setup checklist
              </Text>
              <List type="number">
                <List.Item>
                  The discount is activated automatically when the app is
                  installed — this page just shows its status (and can repair
                  it if it was deleted).
                </List.Item>
                <List.Item>
                  Add the “Bundle &amp; Add-ons” block to your product template
                  in the theme editor.
                </List.Item>
                <List.Item>Configure products on the Home page.</List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
