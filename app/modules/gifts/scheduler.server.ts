/**
 * Gifts module — in-app scheduler (no separate service, no Shopify Flow).
 *
 * Every 10 minutes, per shop with gift campaigns:
 * - if any campaign's start or end passed since the last check → full sync, so
 *   the campaign appears in / disappears from product stamps (checkout
 *   precision ~10 min; the Function's date gate remains a backstop);
 * - once a day → full reconcile anyway (catches anything a webhook missed,
 *   e.g. manual collection edits).
 *
 * Missed boundaries (server restart / deploy) are covered because we compare
 * against the stored last-check time, not the timer tick. A DB lock keeps two
 * instances from running the same shop at once.
 */
import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { syncAll } from "./engine.server";

const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_MS = 45 * 1000;
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
  var __kbGiftScheduler: NodeJS.Timeout | undefined;
}

/** Start the timer once per process (guards against dev reloads). */
export function startGiftScheduler() {
  if (globalThis.__kbGiftScheduler) return;
  if (process.env.KB_GIFT_SCHEDULER === "off") return;
  const tick = () =>
    void schedulerTick().catch((e) => console.error("[gifts] scheduler error", e));
  setTimeout(tick, FIRST_TICK_MS);
  globalThis.__kbGiftScheduler = setInterval(tick, TICK_MS);
  console.log("[gifts] scheduler started (every 10 min)");
}
