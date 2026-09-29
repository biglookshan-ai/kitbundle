import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { buildOffersOverview } from "../models/addon-config.server";
import {
  OfferCountPills,
  OfferEmpty,
  OffersShell,
  useConfigureProduct,
} from "../components/OfferList";
import { PageHead, Btn, Field, Input, List, Row, Thumb, Empty } from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { products } = await buildOffersOverview(admin, session.shop);
  return { products };
};

export default function ProductsIndex() {
  const { products } = useLoaderData<typeof loader>();
  const configure = useConfigureProduct();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = products.filter(
    (p) => !q || p.title.toLowerCase().includes(q),
  );

  return (
    <OffersShell>
      <PageHead
        title="Products"
        subtitle="Every product with bundles, add-ons or offers configured on it."
        actions={
          <Btn variant="primary" onClick={configure}>
            Configure a product
          </Btn>
        }
      />

      {products.length === 0 ? (
        <OfferEmpty
          heading="No products configured yet"
          body="Pick a product to start building bundles, add-ons and offers on it. Everything you create is also listed by type under Bundles, Add-ons and Free gifts."
          onConfigure={configure}
        />
      ) : (
        <>
          <div className="kb-filters" style={{ ["--cols" as string]: "minmax(240px,420px)" }}>
            <Field label="Search">
              <Input
                type="search"
                placeholder="Search products"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
          </div>

          <div className="kb-summary">
            <span>
              {q
                ? `${visible.length} of ${products.length} products`
                : `${products.length} configured ${products.length === 1 ? "product" : "products"}`}
            </span>
          </div>

          <List cols="minmax(0,1fr) auto" head={["Product", ""]}>
            {visible.length === 0 ? (
              <Empty title={`No products match “${query}”`} />
            ) : (
              visible.map((p) => (
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
                  <span className="kb-btn kb-btn--tiny">Manage</span>
                </Row>
              ))
            )}
          </List>
        </>
      )}
    </OffersShell>
  );
}
