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

const DAY = 86_400_000;

/** Month from ?m=YYYY-MM (browser-local), default this month. */
function monthOf(param: string | null) {
  const now = new Date();
  const m = param && /^(\d{4})-(\d{2})$/.exec(param);
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(y, mo, 1);
  const end = new Date(y, mo + 1, 1); // exclusive
  const days = Math.round((end.getTime() - start.getTime()) / DAY);
  return { start, end, days };
}
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export default function GiftCalendar() {
  const { campaigns } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const { start, end, days } = monthOf(params.get("m"));
  const prev = key(new Date(start.getFullYear(), start.getMonth() - 1, 1));
  const next = key(new Date(start.getFullYear(), start.getMonth() + 1, 1));
  const today = new Date();
  const todayCol =
    today >= start && today < end ? today.getDate() : null;

  // Campaigns touching this month (no start = from forever, no end = open).
  const rows = campaigns
    .map((c) => {
      const s = c.startsAt ? new Date(c.startsAt) : null;
      const e = c.endsAt ? new Date(c.endsAt) : null;
      if ((s && s >= end) || (e && e <= start)) return null;
      const from = !s || s < start ? 1 : s.getDate();
      // An end at exactly 00:00 means "through the previous day".
      const lastMs = e ? e.getTime() - 1 : null;
      const to = lastMs === null || lastMs >= end.getTime() ? days : new Date(lastMs).getDate();
      return { c, state: campaignState(c), from, to, openStart: !s || s < start, openEnd: !e || e >= end };
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.to >= r.from)
    .sort((a, b) => a.from - b.from || a.c.title.localeCompare(b.c.title));

  const cols = `220px repeat(${days}, minmax(0, 1fr))`;
  const monthName = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <GiftsShell>
      <PageHead
        title="Calendar"
        subtitle="When each campaign runs. Overlapping bars = campaigns running at the same time."
        actions={
          <>
            <Btn to={`/app/gifts/calendar?m=${prev}`}>‹ Prev</Btn>
            <Btn to="/app/gifts/calendar">Today</Btn>
            <Btn to={`/app/gifts/calendar?m=${next}`}>Next ›</Btn>
          </>
        }
      />
      <div className="kb-cal">
        <div className="kb-cal__title">{monthName}</div>
        <div className="kb-cal__grid" style={{ gridTemplateColumns: cols }}>
          <div className="kb-cal__corner">Campaign</div>
          {Array.from({ length: days }, (_, i) => {
            const d = new Date(start.getFullYear(), start.getMonth(), i + 1);
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={i}
                className={`kb-cal__day${weekend ? " is-weekend" : ""}${todayCol === i + 1 ? " is-today" : ""}`}
              >
                {i + 1}
              </div>
            );
          })}
          {rows.length === 0 ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <Empty title="No campaigns this month" />
            </div>
          ) : (
            <>
              {todayCol ? (
                <div
                  className="kb-cal__todayline"
                  style={{ gridColumn: `${todayCol + 1}`, gridRow: `2 / span ${rows.length}` }}
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
                    style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: i + 2 }}
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
        <span>A square end means the campaign started before, or runs past, this month.</span>
      </div>
    </GiftsShell>
  );
}
