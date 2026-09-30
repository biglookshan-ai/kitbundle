import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  listCampaigns,
  deleteCampaign,
  resyncAll,
  duplicateCampaign,
} from "../models/gift-campaign.server";
import { canCreateCampaign } from "../models/plan.server";
import {
  runSchedulerNow,
  schedulerStatus,
} from "../modules/gifts/scheduler.server";
import {
  campaignState,
  rewardSummary,
  giftQty,
  type GiftCampaign,
  type Ref,
} from "../models/gift-campaign";
import prisma from "../db.server";
import { lastSync } from "../modules/gifts/engine.server";
import {
  GiftsShell,
  STATE_TONE,
  STATE_LABEL,
  fmtWhen,
  fmtRelative,
  timingHint,
  useStockPrice,
  StockCell,
  PriceCell,
} from "../modules/gifts/ui";
import { IconChevron, IconCopy, IconEdit, IconTrash } from "../ui/icons";
import {
  PageHead,
  Stats,
  Field,
  Input,
  Segmented,
  List,
  Pill,
  Thumb,
  Btn,
  IconBtn,
  Empty,
} from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [campaigns, counts, sync, timer] = await Promise.all([
    listCampaigns(session.shop),
    prisma.giftCoverage.groupBy({
      by: ["campaignId"],
      where: { shop: session.shop, role: "trigger" },
      _count: { _all: true },
    }),
    lastSync(session.shop),
    schedulerStatus(session.shop),
  ]);
  // How many products each campaign currently covers (from the gifts index).
  const coverage: Record<string, number> = {};
  for (const r of counts) coverage[r.campaignId] = r._count._all;
  return { campaigns, coverage, sync, timer };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "duplicate") {
    const gate = await canCreateCampaign(billing, session.shop);
    if (!gate.ok) return { ok: false, error: gate.error, message: null };
    const r = await duplicateCampaign(admin, session.shop, String(form.get("id") || ""));
    if (!r.ok || !r.id) return { ok: false, error: r.errors.join("; "), message: null };
    return redirect(`/app/gifts/${r.id}`);
  }
  if (intent === "run-timer") {
    const t = await runSchedulerNow(session.shop);
    const failed = /^(failed|errors)/.test(t.lastResult);
    return {
      ok: !failed,
      error: failed ? t.lastResult : null,
      message: failed ? null : `Schedule checked · ${t.lastResult}`,
    };
  }
  if (intent === "delete") {
    const id = String(form.get("id") || "");
    const r = await deleteCampaign(admin, session.shop, id);
    return { ok: r.ok, error: r.errors.join("; ") || null, message: null };
  }
  if (intent === "resync") {
    const r = await resyncAll(admin, session.shop);
    return {
      ok: r.ok,
      error: r.errors.join("; ") || null,
      message: r.ok ? `Re-synced · ${r.changed} product${r.changed === 1 ? "" : "s"} updated` : null,
    };
  }
  return { ok: false, error: "Unknown action", message: null };
};

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Product / collection chips for the "Buy any of → Get free" flow. */
/** Rule-based trigger labels ("Tag: sale", "Brand: DZOFILM", "All products"). */
function ruleLabels(c: GiftCampaign): string[] {
  if (c.allProducts) return ["All products"];
  return [
    ...c.triggerTags.map((t) => `Tag: ${t}`),
    ...c.triggerVendors.map((v) => `Brand: ${v}`),
    ...c.triggerTypes.map((t) => `Type: ${t}`),
  ];
}

/** "tag “clearance”, 2 products, collection Sale" — or "" when none. */
function excludeText(c: GiftCampaign): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return [
    ...c.excludeTags.map((t) => `tag “${t}”`),
    ...c.excludeVendors.map((v) => `brand “${v}”`),
    ...c.excludeTypes.map((t) => `type “${t}”`),
    ...c.excludeCollections.map((x) => `collection “${x.title || "Untitled"}”`),
    ...(c.excludeProducts.length ? [n(c.excludeProducts.length, "product")] : []),
  ].join(", ");
}

function RefChips({
  products,
  collections = [],
  rules = [],
  gift,
  emptyText,
}: {
  products: Ref[];
  collections?: Ref[];
  rules?: string[];
  gift?: boolean;
  emptyText: string;
}) {
  if (!products.length && !collections.length && !rules.length) {
    return <span className="kb-sub">{emptyText}</span>;
  }
  return (
    <div>
      {rules.map((r) => (
        <span key={r} className="kb-refchip" style={{ paddingLeft: 8 }}>
          <span>{r}</span>
        </span>
      ))}
      {collections.map((c) => (
        <span key={c.id} className="kb-refchip" style={{ paddingLeft: 8 }}>
          <span className="kb-overline" style={{ fontSize: 10 }}>
            Collection
          </span>
          <span>{c.title || "Untitled"}</span>
        </span>
      ))}
      {products.map((p) => (
        <span key={p.id} className={`kb-refchip${gift ? " kb-refchip--gift" : ""}`}>
          <Thumb src={p.image} size={22} alt="" />
          <span>{p.title || p.handle}</span>
        </span>
      ))}
    </div>
  );
}

type Status = "all" | "active" | "scheduled" | "paused" | "draft" | "ended";

export default function GiftCampaigns() {
  const { campaigns, coverage, sync, timer } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [mode, setMode] = useState<"simple" | "detailed">("simple");
  // Per-card override of Simple / Detailed.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  // Report action results as admin toasts.
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    if (d.error) shopify.toast.show(d.error, { isError: true });
    else shopify.toast.show(d.message || "Done");
  }, [fetcher.state, fetcher.data, shopify]);

  const q = query.trim().toLowerCase();
  const visible = campaigns.filter((c) => {
    if (status !== "all" && campaignState(c) !== status) return false;
    if (!q) return true;
    return [
      c.title,
      ...c.triggerProducts.map((p) => p.title),
      ...c.triggerCollections.map((p) => p.title),
      ...ruleLabels(c),
      ...c.giftProducts.map((p) => p.title),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const count = (s: string) => campaigns.filter((c) => campaignState(c) === s).length;
  // Price + stock for the gifts of expanded cards.
  const live = useStockPrice(
    visible
      .filter((c) => openMap[c.id] ?? mode === "detailed")
      .flatMap((c) => c.giftProducts.map((g) => g.id)),
  );

  return (
    <GiftsShell>
      <PageHead
        title="Campaigns"
        subtitle="Free gift offers: buy one of these products, get these gifts free."
        actions={
          <>
            <Btn
              loading={busy && fetcher.formData?.get("intent") === "resync"}
              onClick={() => fetcher.submit({ intent: "resync" }, { method: "POST" })}
            >
              Re-sync
            </Btn>
            <Btn variant="primary" to="/app/gifts/new">
              New campaign
            </Btn>
          </>
        }
      />

      <Stats
        items={[
          { label: "Campaigns", value: campaigns.length },
          { label: "Active", value: count("active") },
          { label: "Scheduled", value: count("scheduled") },
          { label: "Ended", value: count("ended") },
        ]}
      />

      {campaigns.length > 0 ? (
        <div
          className="kb-filters"
          style={{ ["--cols" as string]: "minmax(240px,1fr) auto auto" }}
        >
          <Field label="Search">
            <Input
              type="search"
              placeholder="Campaign, trigger or gift"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Segmented<Status>
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "scheduled", label: "Scheduled" },
              { value: "paused", label: "Paused" },
              { value: "draft", label: "Draft" },
              { value: "ended", label: "Ended" },
            ]}
          />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "simple", label: "Simple" },
              { value: "detailed", label: "Detailed" },
            ]}
          />
        </div>
      ) : null}

      <div className="kb-summary">
        <span>{`${visible.length} campaign${visible.length === 1 ? "" : "s"}`}</span>
        {sync ? (
          <span
            title={sync.errors || undefined}
            style={sync.errors ? { color: "var(--danger)" } : undefined}
          >
            {`Last sync ${fmtWhen(sync.at)} · ${sync.changed} product${sync.changed === 1 ? "" : "s"} updated${
              sync.errors ? " · with errors" : ""
            }`}
          </span>
        ) : null}
      </div>
      <div className="kb-summary" style={{ paddingTop: 0 }}>
        <span
          title="Campaigns switch on and off automatically at their start / end times (plus a safety check every 30 minutes)."
          style={/^(failed|errors)/.test(timer.lastResult) ? { color: "var(--danger)" } : undefined}
        >
          {`Auto schedule: ${
            timer.lastRunAt
              ? `checked ${fmtRelative(timer.lastRunAt)} (${timer.lastResult})`
              : "waiting for first check"
          }${timer.nextBoundary ? ` · next change ${fmtWhen(timer.nextBoundary)}` : ""}`}
        </span>
        <Btn
          size="tiny"
          variant="link"
          loading={busy && fetcher.formData?.get("intent") === "run-timer"}
          onClick={() => fetcher.submit({ intent: "run-timer" }, { method: "POST" })}
        >
          Run now
        </Btn>
      </div>

      {campaigns.length === 0 ? (
        <List cols="1fr">
          <Empty
            title="No gift campaigns yet"
            action={
              <Btn variant="primary" to="/app/gifts/new">
                New campaign
              </Btn>
            }
          >
            Reward customers with a free gift when they buy chosen products or
            collections.
          </Empty>
        </List>
      ) : visible.length === 0 ? (
        <List cols="1fr">
          <Empty title="No campaigns match your search" />
        </List>
      ) : (
        <div className="kb-cards">
          {visible.map((c) => {
            const state = campaignState(c) as keyof typeof STATE_LABEL;
            const covers = coverage[c.id] ?? 0;
            const open = openMap[c.id] ?? mode === "detailed";
            const meta = [
              `Covers ${covers} product${covers === 1 ? "" : "s"}`,
              rewardSummary(c),
              c.endsAt ? `ends ${fmtDate(c.endsAt)}` : null,
              c.startsAt && state === "scheduled" ? `starts ${fmtDate(c.startsAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const doing = (intent: string) =>
              busy &&
              fetcher.formData?.get("intent") === intent &&
              fetcher.formData?.get("id") === c.id;
            return (
              <article key={c.id} className="kb-card">
                <div className="kb-card__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="kb-inline" style={{ gap: 6 }}>
                      <Link
                        to={`/app/gifts/${c.id}`}
                        prefetch="intent"
                        className="kb-title"
                        style={{ display: "inline" }}
                      >
                        {c.title || "Untitled campaign"}
                      </Link>
                      <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
                      {timingHint(c, state) ? <Pill tone="info">{timingHint(c, state)}</Pill> : null}
                      {c.exclusive ? <Pill tone="warn">Exclusive</Pill> : null}
                      {c.priority ? <Pill>{`Priority ${c.priority}`}</Pill> : null}
                    </div>
                    <div className="kb-sub" style={{ marginTop: 3 }}>
                      {meta}
                    </div>
                  </div>
                  <div className="kb-card__actions">
                    <Link
                      to={`/app/gifts/${c.id}`}
                      prefetch="intent"
                      className="kb-iconbtn"
                      title="Edit"
                      aria-label="Edit"
                    >
                      <IconEdit />
                    </Link>
                    <IconBtn
                      label="Duplicate as a draft (no dates)"
                      onClick={() =>
                        doing("duplicate")
                          ? undefined
                          : fetcher.submit({ intent: "duplicate", id: c.id }, { method: "POST" })
                      }
                    >
                      {doing("duplicate") ? <span className="kb-spin" /> : <IconCopy />}
                    </IconBtn>
                    <IconBtn
                      label="Delete"
                      tone="danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete “${c.title || "Untitled campaign"}”? Its gifts stop immediately.`,
                          )
                        ) {
                          fetcher.submit({ intent: "delete", id: c.id }, { method: "POST" });
                        }
                      }}
                    >
                      {doing("delete") ? <span className="kb-spin" /> : <IconTrash />}
                    </IconBtn>
                  </div>
                </div>

                {open ? (
                  <div className="kb-flow">
                    <div>
                      <h4>Buy any of</h4>
                      <RefChips
                        products={c.triggerProducts}
                        collections={c.triggerCollections}
                        rules={ruleLabels(c)}
                        emptyText="No trigger set"
                      />
                      {excludeText(c) ? (
                        <div className="kb-sub" style={{ marginTop: 4 }}>
                          {`Excluding ${excludeText(c)}`}
                        </div>
                      ) : null}
                    </div>
                    <div className="kb-flow__arrow">→</div>
                    <div>
                      <h4>{`Get free (${c.giftProducts.length})`}</h4>
                      {c.giftProducts.length ? (
                        <div className="kb-giftrows">
                          {c.giftProducts.map((g) => (
                            <div key={g.id} className="kb-giftrow">
                              <Thumb src={g.image} size={36} alt="" />
                              <div style={{ minWidth: 0 }}>
                                <div className="kb-title" style={{ fontSize: 13, fontWeight: 500 }}>
                                  {`${giftQty(g) > 1 ? `${giftQty(g)} × ` : ""}${g.title || g.handle}`}
                                </div>
                                <StockCell info={live?.stock[g.id]} needsAccess={live?.needsAccess} />
                              </div>
                              <PriceCell info={live?.price[g.id]} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="kb-sub">No gift set</span>
                      )}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="kb-card__toggle"
                  onClick={() => setOpenMap((m) => ({ ...m, [c.id]: !open }))}
                >
                  {open ? "Hide details" : "Show details"}
                  <IconChevron size={14} up={open} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </GiftsShell>
  );
}
