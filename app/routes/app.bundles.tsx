import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import {
  OfferBrowser,
  OfferEmpty,
  useConfigureProduct,
  type OfferSection,
} from "../components/OfferList";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { lists, currency } = await buildOffersOverview(admin, session.shop);
  return { bundle: lists.bundle, sale: lists.sale, currency };
};

export default function Bundles() {
  const { bundle, sale, currency } = useLoaderData<typeof loader>();
  const configure = useConfigureProduct();
  const empty = bundle.length === 0 && sale.length === 0;

  const sections: OfferSection[] = [];
  if (bundle.length > 0)
    sections.push({ key: "bundle", title: "Bundles", kind: "bundle", rows: bundle });
  if (sale.length > 0)
    sections.push({
      key: "sale",
      title: "Limited-time sale bundles",
      kind: "sale",
      rows: sale,
    });

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
        <OfferBrowser sections={sections} currency={currency} showTypeFilter />
      )}
    </Page>
  );
}
