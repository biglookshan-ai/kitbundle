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
  return { addon: lists.addon, currency };
};

export default function Addons() {
  const { addon, currency } = useLoaderData<typeof loader>();
  const configure = useConfigureProduct();
  const empty = addon.length === 0;

  const sections: OfferSection[] = [
    { key: "addon", title: "Add-ons", kind: "addon", rows: addon },
  ];

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
        <OfferBrowser sections={sections} currency={currency} />
      )}
    </Page>
  );
}
