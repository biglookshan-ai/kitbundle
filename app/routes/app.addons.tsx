import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import {
  OfferTable,
  OfferEmpty,
  SectionCard,
  useConfigureProduct,
} from "../components/OfferList";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { lists } = await buildOffersOverview(admin, session.shop);
  return { addon: lists.addon, free: lists.free };
};

export default function Addons() {
  const { addon, free } = useLoaderData<typeof loader>();
  const configure = useConfigureProduct();
  const empty = addon.length === 0 && free.length === 0;

  return (
    <Page>
      <TitleBar title="Add-ons">
        <button variant="primary" onClick={configure}>
          Configure a product
        </button>
      </TitleBar>
      {empty ? (
        <OfferEmpty
          heading="No add-ons yet"
          body="Offer optional accessories on the product page, each at its own discount — or a free gift. Pick a product to add your first add-on."
          onConfigure={configure}
        />
      ) : (
        <BlockStack gap="400">
          {addon.length > 0 && (
            <SectionCard title={`Add-ons (${addon.length})`}>
              <OfferTable rows={addon} kind="addon" />
            </SectionCard>
          )}
          {free.length > 0 && (
            <SectionCard title={`Free add-ons (${free.length})`}>
              <OfferTable rows={free} kind="free" />
            </SectionCard>
          )}
        </BlockStack>
      )}
    </Page>
  );
}
