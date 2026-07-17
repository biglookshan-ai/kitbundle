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
  return { bundle: lists.bundle, sale: lists.sale };
};

export default function Bundles() {
  const { bundle, sale } = useLoaderData<typeof loader>();
  const configure = useConfigureProduct();
  const empty = bundle.length === 0 && sale.length === 0;

  return (
    <Page>
      <TitleBar title="Bundles">
        <button variant="primary" onClick={configure}>
          Configure a product
        </button>
      </TitleBar>
      {empty ? (
        <OfferEmpty
          heading="No bundles yet"
          body="Group a main product with accessories into a “buy together” kit at a set discount. Pick a product to add your first bundle."
          onConfigure={configure}
        />
      ) : (
        <BlockStack gap="400">
          {bundle.length > 0 && (
            <SectionCard title={`Bundles (${bundle.length})`}>
              <OfferTable rows={bundle} kind="bundle" />
            </SectionCard>
          )}
          {sale.length > 0 && (
            <SectionCard title={`Limited-time sale bundles (${sale.length})`}>
              <OfferTable rows={sale} kind="sale" />
            </SectionCard>
          )}
        </BlockStack>
      )}
    </Page>
  );
}
