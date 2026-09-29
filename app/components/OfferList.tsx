/**
 * Offer lists (bundles / sale bundles / add-ons) on the kb kit: search, type
 * filter, Simple/Detailed, "Show more". Also the shared Offers section frame,
 * empty state and the "Configure a product" picker.
 */
import { useState, type ReactNode } from "react";
import { useNavigate } from "@remix-run/react";
import {
  Shell,
  Btn,
  Empty,
  Field,
  Input,
  List,
  Pill,
  Row,
  Segmented,
  Thumb,
  type TabItem,
} from "../ui/kit";

type Kind = "bundle" | "sale" | "addon" | "free";
type ViewMode = "simple" | "detailed";

type Accessory = {
  title: string;
  image: string | null;
  price: number;
  pct: number;
  now: number;
};

export type OfferRow = {
  key: string;
  groupId: string;
  numericId: string;
  code: string;
  title: string;
  productTitle: string;
  productImage: string | null;
  accessoryCount: number;
  discountPercent: number;
  mainPrice: number;
  accessories: Accessory[];
  origTotal: number;
  nowTotal: number;
  effectivePct: number;
  salePct: number | null;
  saleState: "active" | "upcoming" | "ended" | null;
  saleMode: "revert" | "end" | null;
  startsAt: string | null;
  endsAt: string | null;
  dim: boolean;
};

export type OfferSection = {
  key: string;
  title: string;
  kind: Kind;
  rows: OfferRow[];
};

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(n || 0);
  } catch {
    return "$" + (n || 0).toFixed(2);
  }
}

function fmtDate(iso: string | null) {
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

export const OFFER_TABS: TabItem[] = [
  { label: "Products", to: "/app/products" },
  { label: "Bundles", to: "/app/bundles" },
  { label: "Add-ons", to: "/app/addons" },
];

/** Frame for the offer pages: KitBundle · Offers + Products/Bundles/Add-ons. */
export function OffersShell({ children }: { children: ReactNode }) {
  return (
    <Shell section="Offers" tabs={OFFER_TABS}>
      {children}
    </Shell>
  );
}

function SaleStatusPill({ state }: { state: OfferRow["saleState"] }) {
  if (state === "active") return <Pill tone="ok">Live</Pill>;
  if (state === "upcoming") return <Pill tone="info">Scheduled</Pill>;
  return <Pill>Ended</Pill>;
}

/** Compact one-line sale status + timing for the Simple view. */
function saleShort(r: OfferRow): string {
  if (r.saleState === "active") return `Live · ends ${fmtDate(r.endsAt)}`;
  if (r.saleState === "upcoming")
    return `Scheduled · starts ${fmtDate(r.startsAt)}`;
  return `Ended ${fmtDate(r.endsAt)}`;
}

/** The one-line "what happens with this sale" summary under a sale bundle. */
function saleSummary(r: OfferRow): string {
  const after =
    r.saleMode === "end"
      ? "then the bundle is hidden"
      : `then reverts to ${r.discountPercent}% off`;
  if (r.saleState === "active")
    return `${r.salePct}% off · ends ${fmtDate(r.endsAt)} · ${after}`;
  if (r.saleState === "upcoming")
    return `${r.salePct}% off · starts ${fmtDate(r.startsAt)} · ends ${fmtDate(
      r.endsAt,
    )}`;
  return r.saleMode === "end"
    ? `Ended ${fmtDate(r.endsAt)} · bundle hidden`
    : `Ended ${fmtDate(r.endsAt)} · now ${r.discountPercent}% off`;
}

/** Right-aligned price block: was → now (+ % off chip for kits). */
function PriceBlock({
  r,
  kind,
  currency,
}: {
  r: OfferRow;
  kind: Kind;
  currency: string;
}) {
  return (
    <div className="kb-price">
      <span>
        {r.origTotal > r.nowTotal ? <s>{money(r.origTotal, currency)}</s> : null}
        <b>{money(r.nowTotal, currency)}</b>
      </span>
      {kind !== "addon" && r.effectivePct > 0 ? (
        <Pill tone="danger">{`${r.effectivePct}% off kit`}</Pill>
      ) : null}
    </div>
  );
}

/** One offer row; Detailed adds the item list and the sale schedule. */
function OfferItem({
  r,
  kind,
  currency,
  detailed,
}: {
  r: OfferRow;
  kind: Kind;
  currency: string;
  detailed: boolean;
}) {
  const items = `${r.accessoryCount} ${r.accessoryCount === 1 ? "item" : "items"}`;
  return (
    <Row to={`/app/products/${r.numericId}#${r.groupId}`}>
      <div style={{ minWidth: 0 }}>
        <div className={`kb-offer${r.dim ? " is-dim" : ""}`}>
          <span className={`kb-code${r.dim ? " is-dim" : ""}`}>{r.code || "—"}</span>
          <Thumb src={r.productImage} size={40} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className="kb-inline" style={{ gap: 6 }}>
              <span className="kb-title">{r.title}</span>
              {detailed && kind === "sale" ? <SaleStatusPill state={r.saleState} /> : null}
            </div>
            <div className="kb-sub">
              {detailed
                ? `${kind === "addon" ? "On" : "Main ·"} ${r.productTitle}`
                : `${r.productTitle} · ${items}${kind === "sale" ? ` · ${saleShort(r)}` : ""}`}
            </div>
          </div>
          <PriceBlock r={r} kind={kind} currency={currency} />
        </div>

        {detailed && r.accessories.length > 0 ? (
          <div className="kb-items">
            <div className="kb-overline">
              {`${kind === "addon" ? "Add-ons" : "Includes"} (${r.accessoryCount})`}
            </div>
            {r.accessories.map((a, i) => (
              <div className="kb-items__row" key={i}>
                <Thumb src={a.image} size={28} alt="" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.title}
                </span>
                <span className="kb-price">
                  {a.pct > 0 ? <s>{money(a.price, currency)}</s> : null}
                  <b>{money(a.now, currency)}</b>
                  {a.pct > 0 ? <Pill tone="danger">{`${a.pct}%`}</Pill> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {detailed && kind === "sale" ? (
          <div className="kb-sub" style={{ marginTop: 8 }}>
            {saleSummary(r)}
          </div>
        ) : null}
      </div>
    </Row>
  );
}

const PAGE_STEP = 25;

/**
 * The full offer list surface: a toolbar (search, type filter, Simple/Detailed
 * toggle) over one or more sections. Filtering is client-side — instant even with
 * hundreds of offers. Search matches code, name and main product.
 */
export function OfferBrowser({
  sections,
  currency,
  showTypeFilter,
}: {
  sections: OfferSection[];
  currency: string;
  showTypeFilter?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("simple");
  const [type, setType] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE_STEP);

  const q = query.trim().toLowerCase();
  const match = (r: OfferRow) =>
    !q ||
    r.code.toLowerCase().includes(q) ||
    r.title.toLowerCase().includes(q) ||
    r.productTitle.toLowerCase().includes(q);

  const filtered = sections
    .filter((s) => type === "all" || s.key === type)
    .map((s) => ({ ...s, rows: s.rows.filter(match) }));
  const totalMatches = filtered.reduce((n, s) => n + s.rows.length, 0);
  const typeFilter = showTypeFilter && sections.length > 1;

  return (
    <>
      <div
        className="kb-filters"
        style={{
          ["--cols" as string]: typeFilter
            ? "minmax(240px,1fr) auto auto"
            : "minmax(240px,1fr) auto",
        }}
      >
        <Field label="Search">
          <Input
            type="search"
            placeholder="Search by code, name or product"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE_STEP);
            }}
          />
        </Field>
        {typeFilter ? (
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All" },
              ...sections.map((s) => ({
                value: s.key,
                label: s.title.replace("Limited-time sale bundles", "Sale"),
              })),
            ]}
          />
        ) : null}
        <Segmented<ViewMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "simple", label: "Simple" },
            { value: "detailed", label: "Detailed" },
          ]}
        />
      </div>

      <div className="kb-summary">
        <span>{`${totalMatches} offer${totalMatches === 1 ? "" : "s"}`}</span>
      </div>

      {totalMatches === 0 ? (
        <List cols="1fr">
          <Empty title={`No offers match “${query}”`} />
        </List>
      ) : (
        <div className="kb-stack">
          {filtered.map((s) => {
            if (!s.rows.length) return null;
            const shown = s.rows.slice(0, limit);
            const remaining = s.rows.length - shown.length;
            return (
              <List
                key={s.key}
                cols="minmax(0,1fr)"
                title={
                  <span className="kb-inline" style={{ gap: 8 }}>
                    {s.title}
                    <Pill tone="info">{s.rows.length}</Pill>
                  </span>
                }
                footer={
                  remaining > 0 ? (
                    <button
                      type="button"
                      className="kb-list__more"
                      onClick={() => setLimit((l) => l + PAGE_STEP)}
                    >
                      {`Show ${Math.min(PAGE_STEP, remaining)} more — ${remaining} hidden`}
                    </button>
                  ) : null
                }
              >
                {shown.map((r) => (
                  <OfferItem
                    key={r.key}
                    r={r}
                    kind={s.kind}
                    currency={currency}
                    detailed={mode === "detailed"}
                  />
                ))}
              </List>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Empty state shown when a page has no offers of its kinds yet. */
export function OfferEmpty({
  heading,
  body,
  onConfigure,
}: {
  heading: string;
  body: string;
  onConfigure: () => void;
}) {
  return (
    <List cols="1fr">
      <Empty
        title={heading}
        action={
          <Btn variant="primary" onClick={onConfigure}>
            Configure a product
          </Btn>
        }
      >
        {body}
      </Empty>
    </List>
  );
}

/** Reusable product picker → navigate to that product's editor. */
export function useConfigureProduct() {
  const navigate = useNavigate();
  return async () => {
    const picked = await window.shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
    });
    if (picked && picked[0]) {
      const num = String(picked[0].id).replace("gid://shopify/Product/", "");
      navigate(`/app/products/${num}`);
    }
  };
}

/** Offer-count pills for a configured product (bundle / sale / add-on / free). */
export function OfferCountPills({
  counts,
}: {
  counts: { bundle: number; sale: number; addon: number; free: number };
}) {
  const none = counts.bundle + counts.sale + counts.addon + counts.free === 0;
  if (none) return <span className="kb-sub">No active offers</span>;
  return (
    <div className="kb-pills">
      {counts.bundle > 0 ? <Pill tone="info">{`${counts.bundle} bundle`}</Pill> : null}
      {counts.sale > 0 ? <Pill tone="warn">{`${counts.sale} sale`}</Pill> : null}
      {counts.addon > 0 ? <Pill>{`${counts.addon} add-on`}</Pill> : null}
      {counts.free > 0 ? <Pill tone="ok">{`${counts.free} free`}</Pill> : null}
    </div>
  );
}
