import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import {
  OfferBrowser,
  OfferEmpty,
  OffersShell,
  useConfigureProduct,
  type OfferSection,
} from "../components/OfferList";
import { PageHead, Btn } from "../ui/kit";

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
    <OffersShell>
      <PageHead
        title="Bundles"
        subtitle="Main products sold together with accessories at a set discount, including limited-time sale bundles."
        actions={
          <Btn variant="primary" onClick={configure}>
            Configure a product
          </Btn>
        }
      />
      {empty ? (
        <OfferEmpty
          heading="No bundles yet"
          body="Group a main product with accessories into a “buy together” kit at a set discount. Pick a product to add your first bundle."
          onConfigure={configure}
        />
      ) : (
        <OfferBrowser sections={sections} currency={currency} showTypeFilter />
      )}
    </OffersShell>
  );
}
