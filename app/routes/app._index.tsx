import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import { ensureFunctionDiscount } from "../models/function-discount.server";
import { listCampaigns } from "../models/gift-campaign.server";
import { OfferCountPills, useConfigureProduct } from "../components/OfferList";
import {
  Shell,
  PageHead,
  Btn,
  Banner,
  Stats,
  Panel,
  List,
  Row,
  Thumb,
} from "../ui/kit";

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
    campaignCount: campaigns.filter((c) => c.enabled && !c.draft).length,
    discountActive: ensured.ok,
  };
};

export default function Dashboard() {
  const { products, stats, campaignCount, discountActive } =
    useLoaderData<typeof loader>();
  const configure = useConfigureProduct();
  const isEmpty = stats.products === 0 && campaignCount === 0;
  const recent = products.slice(0, 6);

  return (
    <Shell section="Dashboard">
      <PageHead
        title="Dashboard"
        subtitle="Bundles, add-ons and free gifts at a glance."
        actions={
          <Btn variant="primary" onClick={configure}>
            Configure a product
          </Btn>
        }
      />

      {!discountActive ? (
        <Banner tone="warn">
          <div className="kb-between">
            <span>
              <b>Discounts are not active.</b> The automatic discount that powers
              your offers is missing. Offers will show at full price until it is
              restored.
            </span>
            <Btn size="tiny" to="/app/settings">
              Fix it
            </Btn>
          </div>
        </Banner>
      ) : null}

      <Stats
        items={[
          { label: "Products", value: stats.products, to: "/app/products" },
          { label: "Bundles", value: stats.bundle + stats.sale, to: "/app/bundles" },
          { label: "Add-ons", value: stats.addon + stats.free, to: "/app/addons" },
          { label: "Gift campaigns", value: campaignCount, to: "/app/gifts" },
        ]}
      />

      <div className="kb-grid-2">
        {isEmpty ? (
          <Panel title="Get started in 3 steps">
            <ol className="kb-steps">
              <li>
                Click <b>Configure a product</b> and pick a main product.
              </li>
              <li>Add a bundle, add-on or free gift with a discount, then Save.</li>
              <li>
                In your theme editor, add the <b>KitBundle</b> block to the
                product template.
              </li>
            </ol>
            <Btn variant="primary" onClick={configure}>
              Configure a product
            </Btn>
          </Panel>
        ) : (
          <List
            cols="minmax(0,1fr) auto"
            title={
              <>
                <span>Configured products</span>
                <Link to="/app/products" prefetch="intent" className="kb-btn kb-btn--link kb-small">
                  View all
                </Link>
              </>
            }
          >
            {recent.map((p) => (
              <Row key={p.id} to={`/app/products/${p.numericId}`}>
                <div className="kb-ident">
                  <Thumb src={p.image} size={44} alt="" />
                  <div style={{ minWidth: 0 }}>
                    <span className="kb-title">{p.title}</span>
                    <div style={{ marginTop: 4 }}>
                      <OfferCountPills counts={p.counts} />
                    </div>
                  </div>
                </div>
                <span className="kb-btn kb-btn--tiny">Edit</span>
              </Row>
            ))}
          </List>
        )}

        <aside className="kb-side">
          <Panel
            title={
              <span className="kb-inline" style={{ gap: 8 }}>
                <span className={`kb-dot ${discountActive ? "is-ok" : "is-warn"}`} />
                Status
              </span>
            }
          >
            <p>
              {discountActive
                ? "Automatic discounts are active. Your offers apply at checkout with no codes."
                : "Automatic discounts are not active yet."}
            </p>
            <Btn size="tiny" to="/app/settings">
              Settings
            </Btn>
          </Panel>

          <Panel title="What’s new">
            <p>
              • Free gift manager: campaigns, products, gifts and brands
              <br />• Multi-bundle picker on the product page
            </p>
          </Panel>

          <Panel title="Need help?">
            <p>Email us and we&apos;ll help you set up your first offer.</p>
            <a className="kb-btn kb-btn--link" href="mailto:biglookshan@gmail.com" target="_blank" rel="noreferrer">
              biglookshan@gmail.com
            </a>
          </Panel>
        </aside>
      </div>
    </Shell>
  );
}
