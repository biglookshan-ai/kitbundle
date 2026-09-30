/**
 * Gifts module — in-app scheduler (no separate service, no Shopify Flow).
 *
 * Event-driven: the timer is armed for the NEXT campaign start / end across all
 * shops (a few seconds after it), so a campaign switches on / off right on
 * time. A 30-minute backstop tick always runs as well. On each run, per shop:
 * - if any campaign's start or end passed since the last check → full sync, so
 *   the campaign appears in / disappears from product stamps (the Function's
 *   date gate remains a backstop);
 * - once a day → full reconcile anyway (catches anything a webhook missed,
 *   e.g. manual collection edits).
 * Saving / deleting / duplicating a campaign re-arms the timer.
 *
 * Missed boundaries (server restart / deploy) are covered because we compare
 * against the stored last-check time, not the timer tick. A DB lock keeps two
 * instances from running the same shop at once.
 */
import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { syncAll } from "./engine.server";

const BACKSTOP_MS = 30 * 60 * 1000;
const FIRST_TICK_MS = 45 * 1000;
const AFTER_BOUNDARY_MS = 3000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

/** Campaign start/end instants that fall in (from, to]. */
async function boundariesBetween(shop: string, from: Date, to: Date) {
  return prisma.giftCampaign.count({
    where: {
      shop,
      draft: false,
      enabled: true,
      OR: [
        { startsAt: { gt: from, lte: to } },
        { endsAt: { gt: from, lte: to } },
      ],
    },
  });
}

async function runShop(shop: string, now: Date, force = false) {
  // Take the lock (atomic: only succeeds if nobody holds it).
  await prisma.giftSchedulerState.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
  const got = await prisma.giftSchedulerState.updateMany({
    where: { shop, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (!got.count) return;

  const state = await prisma.giftSchedulerState.findUnique({ where: { shop } });
  let result = "";
  let full = false;
  try {
    const since = state?.lastRunAt ?? null;
    const crossed = since ? await boundariesBetween(shop, since, now) : 1;
    const daily = !state?.lastFullAt || now.getTime() - state.lastFullAt.getTime() > DAILY_MS;
    // Stores that uninstalled the app (no offline session) are skipped quietly.
    const installed = await prisma.session.count({ where: { shop, isOnline: false } });
    if (!installed) {
      result = "skipped: app not installed";
    } else if (force || crossed || daily) {
      full = true;
      const { admin } = await unauthenticated.admin(shop);
      const r = await syncAll(admin, shop, force ? "timer-now" : crossed ? "timer" : "daily");
      result = r.errors.length
        ? `errors: ${r.errors.join("; ").slice(0, 500)}`
        : `${r.changed} product${r.changed === 1 ? "" : "s"} updated`;
    } else {
      result = "nothing due";
    }
  } catch (e) {
    result = `failed: ${String((e as Error)?.message ?? e).slice(0, 500)}`;
    console.error(`[gifts] scheduler failed for ${shop}:`, e);
  } finally {
    await prisma.giftSchedulerState.update({
      where: { shop },
      data: {
        lastRunAt: now,
        ...(full ? { lastFullAt: now } : {}),
        lockedUntil: null,
        lastResult: result,
      },
    });
  }
}

/** One scheduler pass over every shop that has gift campaigns. */
export async function schedulerTick(now = new Date()) {
  const shops = await prisma.giftCampaign.findMany({
    distinct: ["shop"],
    select: { shop: true },
  });
  for (const { shop } of shops) {
    await runShop(shop, now).catch((e) =>
      console.error(`[gifts] scheduler tick failed for ${shop}:`, e),
    );
  }
}

/** Run a shop's check immediately (the admin's "Run now"). */
export async function runSchedulerNow(shop: string) {
  await runShop(shop, new Date(), true);
  return schedulerStatus(shop);
}

/** For the admin: last check, what it did, and when the next one is due. */
export async function schedulerStatus(shop: string) {
  const s = await prisma.giftSchedulerState.findUnique({ where: { shop } });
  const upcoming = await prisma.giftCampaign.findMany({
    where: {
      shop,
      draft: false,
      enabled: true,
      OR: [{ startsAt: { gt: new Date() } }, { endsAt: { gt: new Date() } }],
    },
    select: { startsAt: true, endsAt: true },
  });
  const now = Date.now();
  const next = upcoming
    .flatMap((c) => [c.startsAt, c.endsAt])
    .filter((d): d is Date => !!d && d.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    lastRunAt: s?.lastRunAt?.toISOString() ?? null,
    lastResult: s?.lastResult ?? "",
    nextBoundary: next ? next.toISOString() : null,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __kbGiftTimer: { handle?: NodeJS.Timeout; started?: boolean } | undefined;
}

/** The next campaign start / end after `now`, across every shop. */
async function nextBoundary(now: Date): Promise<Date | null> {
  const where = { draft: false, enabled: true };
  const [s, e] = await Promise.all([
    prisma.giftCampaign.findFirst({
      where: { ...where, startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    }),
    prisma.giftCampaign.findFirst({
      where: { ...where, endsAt: { gt: now } },
      orderBy: { endsAt: "asc" },
      select: { endsAt: true },
    }),
  ]);
  const times = [s?.startsAt, e?.endsAt].filter((d): d is Date => !!d);
  return times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
}

/** (Re)arm the timer for the next boundary, capped by the backstop interval. */
async function arm(delayOverride?: number) {
  const t = (globalThis.__kbGiftTimer ??= {});
  if (t.handle) clearTimeout(t.handle);
  let delay = delayOverride ?? BACKSTOP_MS;
  if (delayOverride === undefined) {
    const next = await nextBoundary(new Date()).catch(() => null);
    if (next) delay = Math.min(delay, Math.max(1000, next.getTime() - Date.now() + AFTER_BOUNDARY_MS));
  }
  t.handle = setTimeout(() => {
    void schedulerTick()
      .catch((e) => console.error("[gifts] scheduler error", e))
      .finally(() => void arm());
  }, delay);
}

/** Call after a campaign's dates / status may have changed. */
export function rescheduleGiftTimer() {
  if (!globalThis.__kbGiftTimer?.started) return;
  void arm().catch((e) => console.error("[gifts] re-arm failed", e));
}

/** Start the timer once per process (guards against dev reloads). */
export function startGiftScheduler() {
  if (process.env.KB_GIFT_SCHEDULER === "off") return;
  const t = (globalThis.__kbGiftTimer ??= {});
  if (t.started) return;
  t.started = true;
  void arm(FIRST_TICK_MS);
  console.log("[gifts] scheduler started (on each campaign start / end + every 30 min)");
}
