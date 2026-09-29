import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useMemo, useState } from "react";
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
  openProductInAdmin,
  fmtWhen,
} from "../modules/gifts/ui";
import {
  PageHead,
  Stats,
  Field,
  Input,
  Select,
  Checkbox,
  List,
  Row,
  Pager,
  Thumb,
  Pill,
  Empty,
  Btn,
} from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureCoverage(admin, session.shop);
  const [views, updatedAt] = await Promise.all([
    buildGiftViews(session.shop),
    coverageUpdatedAt(session.shop),
  ]);
  return {
    products: views.products,
    campaigns: views.campaigns,
    updatedAt,
  };
};

const PAGE = 50;

export default function GiftProducts() {
  const { products, campaigns, updatedAt } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState(params.get("vendor") ?? "all");
  const [campaign, setCampaign] = useState(params.get("campaign") ?? "all");
  const [state, setState] = useState("any");
  const [overlapOnly, setOverlapOnly] = useState(false);
  const giftFilter = params.get("gift") ?? "";
  const [page, setPage] = useState(0);
  const reset = () => setPage(0);

  const vendors = useMemo(
    () =>
      [...new Set(products.map((p) => p.vendor || ""))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [products],
  );

  const q = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (vendor !== "all" && (p.vendor || "") !== vendor) return false;
    if (campaign !== "all" && !p.campaigns.some((c) => c.id === campaign))
      return false;
    if (giftFilter && !p.gifts.some((g) => g.productId.endsWith(`/${giftFilter}`)))
      return false;
    if (state === "active" && p.activeCampaigns === 0) return false;
    if (state === "inactive" && p.activeCampaigns > 0) return false;
    if (overlapOnly && p.activeCampaigns < 2) return false;
    if (!q) return true;
    return [p.title, p.vendor, p.productType, ...p.gifts.map((g) => g.title)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const giftName =
    giftFilter &&
    products
      .flatMap((p) => p.gifts)
      .find((g) => g.productId.endsWith(`/${giftFilter}`))?.title;
  const activeNow = products.filter((p) => p.activeCampaigns > 0).length;
  const overlaps = products.filter((p) => p.activeCampaigns > 1).length;

  return (
    <GiftsShell>
      <PageHead
        title="Products with gifts"
        subtitle={`Every product that earns a free gift, and where it comes from · index updated ${fmtWhen(updatedAt)}`}
        actions={<RebuildButton />}
      />

      <Stats
        items={[
          { label: "Products with gifts", value: products.length },
          { label: "Giving a gift now", value: activeNow },
          { label: "Brands", value: vendors.length },
          { label: "In 2+ active campaigns", value: overlaps, danger: overlaps > 0 },
        ]}
      />

      <div
        className="kb-filters"
        style={{
          ["--cols" as string]:
            "minmax(220px,1.6fr) repeat(3,minmax(150px,1fr)) auto",
        }}
      >
        <Field label="Search">
          <Input
            type="search"
            placeholder="Products, brands or gifts"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
          />
        </Field>
        <Field label="Brand">
          <Select
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value);
              reset();
            }}
          >
            <option value="all">All brands</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v || "(No brand)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Campaign">
          <Select
            value={campaign}
            onChange={(e) => {
              setCampaign(e.target.value);
              reset();
            }}
          >
            <option value="all">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              reset();
            }}
          >
            <option value="any">Any</option>
            <option value="active">Giving a gift now</option>
            <option value="inactive">Not giving now</option>
          </Select>
        </Field>
        <div style={{ height: 38, display: "flex", alignItems: "center" }}>
          <Checkbox
            label="Only overlaps"
            checked={overlapOnly}
            onChange={(v) => {
              setOverlapOnly(v);
              reset();
            }}
          />
        </div>
      </div>

      <div className="kb-summary">
        <span>{`${filtered.length} product${filtered.length === 1 ? "" : "s"}`}</span>
        {giftName ? (
          <span className="kb-inline">
            <Pill tone="info">{`Giving: ${giftName}`}</Pill>
            <Btn
              variant="link"
              size="tiny"
              onClick={() => {
                params.delete("gift");
                setParams(params);
              }}
            >
              Clear
            </Btn>
          </span>
        ) : null}
      </div>

      <List
        cols="minmax(0,1.5fr) 150px minmax(0,1.3fr) 160px"
        head={["Product", "Gifts", "Campaigns", "Included via"]}
        footer={
          <Pager page={page} pageSize={PAGE} total={filtered.length} onPage={setPage} />
        }
      >
        {products.length === 0 ? (
          <Empty title="No products give a gift yet">
            Create a gift campaign and its trigger products will appear here.
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title="No products match these filters" />
        ) : (
          rows.map((p) => (
            <Row key={p.productId}>
              <div className="kb-ident">
                <Thumb src={p.image} />
                <div style={{ minWidth: 0 }}>
                  <div className="kb-overline">{p.vendor || "—"}</div>
                  <button
                    type="button"
                    className="kb-title"
                    title="Open in Shopify admin"
                    onClick={() => openProductInAdmin(p.numericId)}
                  >
                    {p.title || p.handle}
                  </button>
                  <div className="kb-inline" style={{ marginTop: 3 }}>
                    {p.productType ? <span className="kb-sub">{p.productType}</span> : null}
                    {p.status && p.status !== "ACTIVE" ? (
                      <Pill tone={p.status === "DELETED" ? "danger" : "warn"}>
                        {p.status.toLowerCase()}
                      </Pill>
                    ) : null}
                    {p.activeCampaigns > 1 ? (
                      <Pill tone="warn">{`${p.activeCampaigns} active campaigns`}</Pill>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="kb-thumbs">
                {p.gifts.slice(0, 4).map((g) => (
                  <Thumb key={g.productId} src={g.image} size={28} alt={g.title} />
                ))}
                <span className="kb-sub" style={{ marginLeft: 4 }}>
                  {p.gifts.length > 4
                    ? `+${p.gifts.length - 4}`
                    : `${p.gifts.length} gift${p.gifts.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <CampaignPills campaigns={p.campaigns} />
              <span className="kb-sub">{p.via.join(" · ") || "—"}</span>
            </Row>
          ))
        )}
      </List>
    </GiftsShell>
  );
}
