import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  ensureCoverage,
  coverageUpdatedAt,
} from "../modules/gifts/coverage.server";
import { buildGiftViews } from "../modules/gifts/views.server";
import {
  GiftsShell,
  CampaignPills,
  RebuildButton,
  fmtWhen,
} from "../modules/gifts/ui";
import { PageHead, Stats, Field, Input, List, Row, Empty } from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureCoverage(admin, session.shop);
  const [views, updatedAt] = await Promise.all([
    buildGiftViews(session.shop),
    coverageUpdatedAt(session.shop),
  ]);
  return { brands: views.brands, updatedAt };
};

export default function GiftBrands() {
  const { brands, updatedAt } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = brands.filter(
    (b) => !q || (b.vendor || "(no brand)").toLowerCase().includes(q),
  );
  const products = brands.reduce((n, b) => n + b.productCount, 0);

  return (
    <GiftsShell>
      <PageHead
        title="Brands"
        subtitle={`Gift coverage grouped by brand · index updated ${fmtWhen(updatedAt)}`}
        actions={<RebuildButton />}
      />

      <Stats
        items={[
          { label: "Brands with gifts", value: brands.length },
          { label: "Products with gifts", value: products },
        ]}
      />

      <div className="kb-filters" style={{ ["--cols" as string]: "minmax(240px,420px)" }}>
        <Field label="Search">
          <Input
            type="search"
            placeholder="Brand name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      </div>

      <div className="kb-summary">
        <span>{`${visible.length} brand${visible.length === 1 ? "" : "s"}`}</span>
      </div>

      <List
        cols="minmax(0,1fr) 170px 140px minmax(0,1.6fr)"
        head={["Brand", "Products with gifts", "Distinct gifts", "Campaigns"]}
      >
        {brands.length === 0 ? (
          <Empty title="No brands yet">
            Brands appear once their products are part of a gift campaign.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty title="No brands match" />
        ) : (
          visible.map((b) => (
            <Row key={b.vendor || "_none"}>
              <Link
                to={`/app/gifts/products?vendor=${encodeURIComponent(b.vendor)}`}
                prefetch="intent"
                className="kb-title"
              >
                {b.vendor || "(No brand)"}
              </Link>
              <div>
                <div style={{ fontWeight: 600 }}>{b.productCount}</div>
                <div className="kb-sub">{`${b.activeProductCount} giving now`}</div>
              </div>
              <span style={{ fontWeight: 600 }}>{b.giftCount}</span>
              <CampaignPills campaigns={b.campaigns} />
            </Row>
          ))
        )}
      </List>
    </GiftsShell>
  );
}
