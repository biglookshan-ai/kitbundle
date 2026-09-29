import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  listCampaigns,
  deleteCampaign,
  resyncAll,
} from "../models/gift-campaign.server";
import {
  campaignState,
  rewardSummary,
  type GiftCampaign,
  type Ref,
} from "../models/gift-campaign";
import prisma from "../db.server";
import { lastSync } from "../modules/gifts/engine.server";
import { GiftsShell, STATE_TONE, STATE_LABEL, fmtWhen } from "../modules/gifts/ui";
import {
  PageHead,
  Stats,
  Field,
  Input,
  Segmented,
  List,
  Row,
  Pill,
  Thumb,
  Btn,
  Empty,
} from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [campaigns, counts, sync] = await Promise.all([
    listCampaigns(session.shop),
    prisma.giftCoverage.groupBy({
      by: ["campaignId"],
      where: { shop: session.shop, role: "trigger" },
      _count: { _all: true },
    }),
    lastSync(session.shop),
  ]);
  // How many products each campaign currently covers (from the gifts index).
  const coverage: Record<string, number> = {};
  for (const r of counts) coverage[r.campaignId] = r._count._all;
  return { campaigns, coverage, sync };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
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

type Status = "all" | "active" | "scheduled" | "ended";

export default function GiftCampaigns() {
  const { campaigns, coverage, sync } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [mode, setMode] = useState<"simple" | "detailed">("simple");

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

      <List cols="minmax(0,1fr) auto">
        {campaigns.length === 0 ? (
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
        ) : visible.length === 0 ? (
          <Empty title="No campaigns match your search" />
        ) : (
          visible.map((c) => {
            const state = campaignState(c) as keyof typeof STATE_LABEL;
            const covers = coverage[c.id] ?? 0;
            const meta = [
              `Covers ${covers} product${covers === 1 ? "" : "s"}`,
              rewardSummary(c),
              c.endsAt ? `ends ${fmtDate(c.endsAt)}` : null,
              c.startsAt && state === "scheduled"
                ? `starts ${fmtDate(c.startsAt)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const deleting =
              busy &&
              fetcher.formData?.get("intent") === "delete" &&
              fetcher.formData?.get("id") === c.id;
            return (
              <Row key={c.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="kb-inline">
                    <span className="kb-title" style={{ display: "inline" }}>
                      {c.title || "Untitled campaign"}
                    </span>
                    <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
                    {c.exclusive ? <Pill tone="warn">Exclusive</Pill> : null}
                    {c.priority ? <Pill>{`Priority ${c.priority}`}</Pill> : null}
                  </div>
                  <div className="kb-sub" style={{ marginTop: 2 }}>
                    {meta}
                  </div>
                  {mode === "detailed" ? (
                    <div className="kb-flow">
                      <div>
                        <h4>Buy any of</h4>
                        <RefChips
                          products={c.triggerProducts}
                          collections={c.triggerCollections}
                          rules={ruleLabels(c)}
                          emptyText="No trigger set"
                        />
                        {c.excludeTags.length || c.excludeProducts.length ? (
                          <div className="kb-sub" style={{ marginTop: 4 }}>
                            {`Excluding ${[
                              ...c.excludeTags.map((t) => `tag “${t}”`),
                              ...(c.excludeProducts.length
                                ? [`${c.excludeProducts.length} product${c.excludeProducts.length === 1 ? "" : "s"}`]
                                : []),
                            ].join(", ")}`}
                          </div>
                        ) : null}
                      </div>
                      <div className="kb-flow__arrow">→</div>
                      <div>
                        <h4>{`Get free (${c.giftProducts.length})`}</h4>
                        <RefChips products={c.giftProducts} gift emptyText="No gift set" />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="kb-inline" style={{ alignSelf: "start", paddingTop: 2 }}>
                  <Btn size="tiny" to={`/app/gifts/${c.id}`}>
                    Edit
                  </Btn>
                  <Btn
                    size="tiny"
                    variant="danger"
                    loading={deleting}
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
                    Delete
                  </Btn>
                </div>
              </Row>
            );
          })
        )}
      </List>
    </GiftsShell>
  );
}
