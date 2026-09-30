import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureCoverage, coverageUpdatedAt } from "../modules/gifts/coverage.server";
import { buildGiftViews } from "../modules/gifts/views.server";
import {
  addGiftToCampaign,
  addToPool,
  listPool,
  removeFromPool,
} from "../modules/gifts/pool.server";
import type { Ref } from "../models/gift-campaign";
import {
  GiftsShell,
  CampaignPills,
  RebuildButton,
  openProductInAdmin,
  fmtWhen,
  useStockPrice,
  StockCell,
  PriceCell,
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
  Btn,
  IconBtn,
} from "../ui/kit";
import { IconTrash } from "../ui/icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureCoverage(admin, session.shop);
  const [views, updatedAt, pool] = await Promise.all([
    buildGiftViews(session.shop),
    coverageUpdatedAt(session.shop),
    listPool(session.shop),
  ]);
  return {
    gifts: views.gifts,
    campaigns: views.campaigns,
    pool: pool.map((p) => ({
      productId: p.productId,
      title: p.title,
      handle: p.handle,
      image: p.image,
    })),
    updatedAt,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "add") {
    let refs: Ref[] = [];
    try {
      refs = JSON.parse(String(form.get("refs") || "[]"));
    } catch {
      refs = [];
    }
    await addToPool(session.shop, refs);
    return { ok: true, message: `${refs.length} added to the gift pool`, error: null };
  }
  if (intent === "remove") {
    await removeFromPool(session.shop, String(form.get("productId") || ""));
    return { ok: true, message: "Removed from the gift pool", error: null };
  }
  if (intent === "give") {
    let gift: Ref;
    try {
      gift = JSON.parse(String(form.get("gift")));
    } catch {
      return { ok: false, message: null, error: "Invalid gift" };
    }
    const r = await addGiftToCampaign(admin, session.shop, String(form.get("campaignId")), gift);
    if (!r.ok) return { ok: false, message: null, error: r.errors.join("; ") };
    return {
      ok: true,
      message: r.already ? "Already a gift in that campaign" : "Added to the campaign",
      error: null,
    };
  }
  return { ok: false, message: null, error: "Unknown action" };
};

type Show = "all" | "unused" | "active" | "risk";

export default function GiftPool() {
  const { gifts, campaigns, pool, updatedAt } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [giveOpen, setGiveOpen] = useState<string | null>(null);
  const [target, setTarget] = useState("");

  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    if (d.error) shopify.toast.show(d.error, { isError: true });
    else if (d.message) shopify.toast.show(d.message);
  }, [fetcher.state, fetcher.data, shopify]);

  // Pool ∪ gifts already used in campaigns, one row per product.
  const inPool = new Set(pool.map((p) => p.productId));
  const byId = new Map(gifts.map((g) => [g.productId, g]));
  const rows = [
    ...gifts,
    ...pool
      .filter((p) => !byId.has(p.productId))
      .map((p) => ({
        productId: p.productId,
        numericId: p.productId.split("/").pop() || "",
        title: p.title,
        handle: p.handle,
        image: p.image,
        vendor: "",
        status: "",
        totalInventory: null as number | null,
        campaigns: [] as (typeof gifts)[number]["campaigns"],
        triggerCount: 0,
        activeTriggerCount: 0,
      })),
  ];

  const q = query.trim().toLowerCase();
  const visible = rows.filter((g) => {
    if (show === "unused" && !(inPool.has(g.productId) && g.campaigns.length === 0)) return false;
    if (show === "active" && g.activeTriggerCount === 0) return false;
    if (show === "risk" && !(g.totalInventory !== null && g.totalInventory <= 5)) return false;
    if (!q) return true;
    return [g.title, g.vendor].join(" ").toLowerCase().includes(q);
  });
  const live = useStockPrice(visible.slice(0, 100).map((g) => g.productId));

  const addToPoolPick = async () => {
    const picked = await shopify.resourcePicker({ type: "product", multiple: true, action: "select" });
    if (!picked?.length) return;
    const refs: Ref[] = picked.map((p: any) => ({
      id: p.id,
      title: p.title || "",
      handle: p.handle || "",
      image: p.images?.[0]?.originalSrc ?? p.images?.[0]?.src ?? null,
    }));
    fetcher.submit({ intent: "add", refs: JSON.stringify(refs) }, { method: "POST" });
  };

  const unused = pool.filter((p) => !(byId.get(p.productId)?.campaigns.length)).length;
  const beingGiven = rows.filter((g) => g.activeTriggerCount > 0).length;
  const liveCampaigns = campaigns.filter((c) => c.state !== "ended");

  return (
    <GiftsShell>
      <PageHead
        title="Gift pool"
        subtitle={`Products you can give away — set some aside, then give them with a campaign · index updated ${fmtWhen(updatedAt)}`}
        actions={
          <>
            <RebuildButton />
            <Btn variant="primary" onClick={addToPoolPick}>
              + Add to pool
            </Btn>
          </>
        }
      />

      <Stats
        items={[
          { label: "In the pool", value: pool.length },
          { label: "In pool, not given yet", value: unused },
          { label: "Being given now", value: beingGiven },
          { label: "Gifts in campaigns", value: gifts.length },
        ]}
      />

      <div
        className="kb-filters"
        style={{ ["--cols" as string]: "minmax(240px,2fr) minmax(200px,1fr)" }}
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
          <Select value={show} onChange={(e) => setShow(e.target.value as Show)}>
            <option value="all">All gifts</option>
            <option value="unused">In the pool, not given yet</option>
            <option value="active">Being given now</option>
            <option value="risk">Low / out of stock</option>
          </Select>
        </Field>
      </div>

      <div className="kb-summary">
        <span>{`${visible.length} gift${visible.length === 1 ? "" : "s"}`}</span>
      </div>

      <List
        cols="minmax(0,1.5fr) 100px 190px 120px minmax(0,1.1fr) auto"
        head={["Gift", "Price", "Stock", "Given by", "Campaigns", ""]}
      >
        {rows.length === 0 ? (
          <Empty
            title="The gift pool is empty"
            action={
              <Btn variant="primary" onClick={addToPoolPick}>
                + Add to pool
              </Btn>
            }
          >
            Add cheap or overstocked products you&apos;re happy to give away, then
            give them with a campaign.
          </Empty>
        ) : visible.length === 0 ? (
          <Empty title="No gifts match these filters" />
        ) : (
          visible.map((g) => {
            const gift: Ref = {
              id: g.productId,
              title: g.title,
              handle: g.handle || pool.find((p) => p.productId === g.productId)?.handle || "",
              image: g.image,
            };
            return (
              <div key={g.productId} style={{ display: "contents" }}>
                <Row>
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
                      <div className="kb-inline" style={{ marginTop: 3, gap: 4 }}>
                        {inPool.has(g.productId) ? <Pill tone="info">In pool</Pill> : null}
                        {g.status && g.status !== "ACTIVE" ? (
                          <Pill tone={g.status === "DELETED" ? "danger" : "warn"}>
                            {g.status.toLowerCase()}
                          </Pill>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <PriceCell info={live?.price[g.productId]} />
                  <StockCell info={live?.stock[g.productId]} needsAccess={live?.needsAccess} />
                  <div>
                    {g.triggerCount ? (
                      <Link
                        to={`/app/gifts/products?gift=${g.numericId}`}
                        prefetch="intent"
                        className="kb-title"
                        style={{ fontWeight: 600, color: "var(--link)" }}
                      >
                        {`${g.triggerCount} product${g.triggerCount === 1 ? "" : "s"}`}
                      </Link>
                    ) : (
                      <span className="kb-muted">Not given</span>
                    )}
                    {g.triggerCount ? (
                      <div className="kb-sub">{`${g.activeTriggerCount} giving it now`}</div>
                    ) : null}
                  </div>
                  <CampaignPills campaigns={g.campaigns} />
                  <div className="kb-inline" style={{ flexWrap: "nowrap", gap: 2 }}>
                    <Btn
                      size="tiny"
                      onClick={() => {
                        setGiveOpen(giveOpen === g.productId ? null : g.productId);
                        setTarget("");
                      }}
                    >
                      Give…
                    </Btn>
                    {inPool.has(g.productId) ? (
                      <IconBtn
                        label="Remove from pool"
                        tone="danger"
                        onClick={() =>
                          fetcher.submit(
                            { intent: "remove", productId: g.productId },
                            { method: "POST" },
                          )
                        }
                      >
                        <IconTrash />
                      </IconBtn>
                    ) : null}
                  </div>
                </Row>
                {giveOpen === g.productId ? (
                  <div className="kb-rowpanel">
                    <Btn
                      size="tiny"
                      variant="primary"
                      to={`/app/gifts/new?gift=${encodeURIComponent(g.productId)}`}
                    >
                      New campaign with this gift
                    </Btn>
                    <span className="kb-muted">or add to</span>
                    <Select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      style={{ width: 260 }}
                    >
                      <option value="">Choose a campaign…</option>
                      {liveCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {`${c.title} (${c.state})`}
                        </option>
                      ))}
                    </Select>
                    <Btn
                      size="tiny"
                      disabled={!target}
                      loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "give"}
                      onClick={() =>
                        fetcher.submit(
                          { intent: "give", campaignId: target, gift: JSON.stringify(gift) },
                          { method: "POST" },
                        )
                      }
                    >
                      Add
                    </Btn>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </List>
    </GiftsShell>
  );
}
