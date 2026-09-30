import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { listCampaigns } from "../models/gift-campaign.server";
import { campaignState } from "../models/gift-campaign";
import { GiftsShell, STATE_LABEL, STATE_TONE, fmtWhen } from "../modules/gifts/ui";
import { PageHead, Btn, Pill, Empty } from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaigns = await listCampaigns(session.shop);
  return { campaigns };
};

type View = "week" | "month" | "quarter";
type Col = {
  start: Date;
  end: Date; // exclusive
  label: string;
  sub?: string;
  weekend?: boolean;
  today?: boolean;
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

/**
 * Columns for a view around an anchor date (browser-local): a week and a month
 * are one column per day; a quarter is one column per week (days would be too
 * narrow to read).
 */
function columnsFor(view: View, anchor: Date) {
  const today = new Date();
  const cols: Col[] = [];
  let title: string;
  let prev: Date;
  let next: Date;
  if (view === "week") {
    const start = mondayOf(anchor);
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      cols.push({
        start: d,
        end: addDays(d, 1),
        label: d.toLocaleDateString(undefined, { weekday: "short" }),
        sub: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        weekend: i >= 5,
        today: sameDay(d, today),
      });
    }
    title = `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${addDays(
      start,
      6,
    ).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
    prev = addDays(start, -7);
    next = addDays(start, 7);
  } else if (view === "quarter") {
    const q0 = new Date(anchor.getFullYear(), Math.floor(anchor.getMonth() / 3) * 3, 1);
    const qEnd = new Date(q0.getFullYear(), q0.getMonth() + 3, 1);
    for (let d = mondayOf(q0); d < qEnd; d = addDays(d, 7)) {
      const end = addDays(d, 7);
      cols.push({
        start: d,
        end,
        label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        today: today >= d && today < end,
      });
    }
    title = `Q${Math.floor(q0.getMonth() / 3) + 1} ${q0.getFullYear()} · one column per week`;
    prev = new Date(q0.getFullYear(), q0.getMonth() - 3, 1);
    next = qEnd;
  } else {
    const m0 = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const mEnd = new Date(m0.getFullYear(), m0.getMonth() + 1, 1);
    for (let d = m0; d < mEnd; d = addDays(d, 1)) {
      cols.push({
        start: d,
        end: addDays(d, 1),
        label: String(d.getDate()),
        weekend: d.getDay() === 0 || d.getDay() === 6,
        today: sameDay(d, today),
      });
    }
    title = m0.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    prev = new Date(m0.getFullYear(), m0.getMonth() - 1, 1);
    next = mEnd;
  }
  return { cols, title, prev, next };
}

const VIEWS: { value: View; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
];

export default function GiftCalendar() {
  const { campaigns } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const raw = params.get("view");
  const view: View = raw === "week" || raw === "quarter" ? raw : "month";
  const dParam = params.get("d");
  const anchor =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? new Date(`${dParam}T12:00:00`) : new Date();
  const { cols, title, prev, next } = columnsFor(view, anchor);
  const rangeStart = cols[0].start;
  const rangeEnd = cols[cols.length - 1].end;
  const todayIdx = cols.findIndex((c) => c.today);
  const href = (v: View, d?: Date) => `/app/gifts/calendar?view=${v}${d ? `&d=${ymd(d)}` : ""}`;

  // Campaigns touching this range (no start = from forever, no end = open).
  const rows = campaigns
    .map((c) => {
      const s = c.startsAt ? new Date(c.startsAt) : null;
      const e = c.endsAt ? new Date(c.endsAt) : null;
      if ((s && s >= rangeEnd) || (e && e <= rangeStart)) return null;
      const sMs = s ? s.getTime() : -Infinity;
      const eMs = e ? e.getTime() : Infinity;
      const from = cols.findIndex((col) => col.end.getTime() > sMs);
      let to = -1;
      cols.forEach((col, i) => {
        if (col.start.getTime() < eMs) to = i;
      });
      if (from < 0 || to < from) return null;
      return {
        c,
        state: campaignState(c),
        from,
        to,
        openStart: !s || s < rangeStart,
        openEnd: !e || e > rangeEnd,
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.from - b.from || a.c.title.localeCompare(b.c.title));

  const gridCols = `220px repeat(${cols.length}, minmax(0, 1fr))`;

  return (
    <GiftsShell>
      <PageHead
        title="Calendar"
        subtitle="When each campaign runs. Overlapping bars = campaigns running at the same time."
        actions={
          <>
            <div className="kb-seg" role="tablist">
              {VIEWS.map((v) => (
                <Link
                  key={v.value}
                  to={href(v.value, anchor)}
                  prefetch="intent"
                  className={view === v.value ? "is-active" : undefined}
                >
                  {v.label}
                </Link>
              ))}
            </div>
            <Btn to={href(view, prev)}>‹ Prev</Btn>
            <Btn to={href(view)}>Today</Btn>
            <Btn to={href(view, next)}>Next ›</Btn>
          </>
        }
      />
      <div className="kb-cal">
        <div className="kb-cal__title">{title}</div>
        <div
          className={`kb-cal__grid kb-cal__grid--${view}`}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="kb-cal__corner">Campaign</div>
          {cols.map((col, i) => (
            <div
              key={i}
              className={`kb-cal__day${col.weekend ? " is-weekend" : ""}${col.today ? " is-today" : ""}`}
            >
              <span>
                {col.label}
                {col.sub ? <small>{col.sub}</small> : null}
              </span>
            </div>
          ))}
          {rows.length === 0 ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <Empty title="No campaigns in this period" />
            </div>
          ) : (
            <>
              {todayIdx >= 0 ? (
                <div
                  className="kb-cal__todayline"
                  style={{ gridColumn: `${todayIdx + 2}`, gridRow: `2 / span ${rows.length}` }}
                />
              ) : null}
              {rows.map(({ c, state, from, to, openStart, openEnd }, i) => (
                <div key={c.id} style={{ display: "contents" }}>
                  <Link
                    to={`/app/gifts/${c.id}`}
                    prefetch="intent"
                    className="kb-cal__name"
                    style={{ gridRow: i + 2 }}
                  >
                    <span className="kb-title">{c.title || "Untitled campaign"}</span>
                    <Pill tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Pill>
                  </Link>
                  <Link
                    to={`/app/gifts/${c.id}`}
                    prefetch="intent"
                    className={`kb-cal__bar kb-cal__bar--${state}${openStart ? " is-open-start" : ""}${openEnd ? " is-open-end" : ""}`}
                    style={{ gridColumn: `${from + 2} / ${to + 3}`, gridRow: i + 2 }}
                    title={`${c.title || "Untitled"} · ${c.startsAt ? fmtWhen(c.startsAt) : "no start"} → ${
                      c.endsAt ? fmtWhen(c.endsAt) : "no end"
                    }`}
                  >
                    {c.title || "Untitled"}
                  </Link>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="kb-summary">
        <span>A square end means the campaign started before, or runs past, this period.</span>
      </div>
    </GiftsShell>
  );
}
