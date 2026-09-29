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
  openProductInAdmin,
  fmtWhen,
} from "../modules/gifts/ui";
import {
  PageHead,
  Stats,
  Field,
  Input,
  Select,
  List,
  Row,
  Thumb,
  Pill,
  Empty,
} from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureCoverage(admin, session.shop);
  const [views, updatedAt] = await Promise.all([
    buildGiftViews(session.shop),
    coverageUpdatedAt(session.shop),
  ]);
  return { gifts: views.gifts, updatedAt };
};

/** Stock pill: out of stock / low / count / not tracked. */
function StockPill({ qty }: { qty: number | null }) {
  if (qty === null) return <Pill>Not tracked</Pill>;
  if (qty <= 0) return <Pill tone="danger">Out of stock</Pill>;
  if (qty <= 5) return <Pill tone="warn">{`Low · ${qty}`}</Pill>;
  return <Pill tone="ok">{`${qty} in stock`}</Pill>;
}

export default function GiftItems() {
  const { gifts, updatedAt } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState("all");

  const q = query.trim().toLowerCase();
  const visible = gifts.filter((g) => {
    if (show === "risk" && !(g.totalInventory !== null && g.totalInventory <= 5))
      return false;
    if (show === "active" && g.activeTriggerCount === 0) return false;
    if (!q) return true;
    return [g.title, g.vendor].join(" ").toLowerCase().includes(q);
  });

  const beingGiven = gifts.filter((g) => g.activeTriggerCount > 0).length;
  const atRisk = gifts.filter(
    (g) => g.totalInventory !== null && g.totalInventory <= 5,
  ).length;

  return (
    <GiftsShell>
      <PageHead
        title="Gifts"
        subtitle={`Every gift product, how many products give it, and whether stock can keep up · index updated ${fmtWhen(updatedAt)}`}
        actions={<RebuildButton />}
      />

      <Stats
        items={[
          { label: "Gift products", value: gifts.length },
          { label: "Being given now", value: beingGiven },
          { label: "Low or out of stock", value: atRisk, danger: atRisk > 0 },
        ]}
      />

      <div
        className="kb-filters"
        style={{ ["--cols" as string]: "minmax(240px,2fr) minmax(180px,1fr)" }}
      >
        <Field label="Search">
          <Input
            type="search"
            placeholder="Gift name or brand"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="Show">
          <Select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">All gifts</option>
            <option value="active">Being given now</option>
            <option value="risk">Low / out of stock</option>
          </Select>
        </Field>
      </div>

      <div className="kb-summary">
        <span>{`${visible.length} gift${visible.length === 1 ? "" : "s"}`}</span>
      </div>

      <List
        cols="minmax(0,1.6fr) 140px 160px minmax(0,1.3fr)"
        head={["Gift", "Stock", "Given by", "Campaigns"]}
      >
        {gifts.length === 0 ? (
          <Empty title="No gifts configured yet">
            Gift products from your campaigns will appear here.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty title="No gifts match these filters" />
        ) : (
          visible.map((g) => (
            <Row key={g.productId}>
              <div className="kb-ident">
                <Thumb src={g.image} />
                <div style={{ minWidth: 0 }}>
                  <div className="kb-overline">{g.vendor || "—"}</div>
                  <button
                    type="button"
                    className="kb-title"
                    title="Open in Shopify admin"
                    onClick={() => openProductInAdmin(g.numericId)}
                  >
                    {g.title}
                  </button>
                  {g.status && g.status !== "ACTIVE" ? (
                    <div style={{ marginTop: 3 }}>
                      <Pill tone={g.status === "DELETED" ? "danger" : "warn"}>
                        {g.status.toLowerCase()}
                      </Pill>
                    </div>
                  ) : null}
                </div>
              </div>
              <StockPill qty={g.totalInventory} />
              <div>
                <Link
                  to={`/app/gifts/products?gift=${g.numericId}`}
                  prefetch="intent"
                  className="kb-title"
                  style={{ fontWeight: 600, color: "var(--link)" }}
                >
                  {`${g.triggerCount} product${g.triggerCount === 1 ? "" : "s"}`}
                </Link>
                <div className="kb-sub">{`${g.activeTriggerCount} giving it now`}</div>
              </div>
              <CampaignPills campaigns={g.campaigns} />
            </Row>
          ))
        )}
      </List>
    </GiftsShell>
  );
}
