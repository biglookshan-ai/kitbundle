import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../modules/gifts/__test__/memory-db";
import { emptyCampaign, rowToCampaign } from "./gift-campaign";
import { duplicateCampaign, getCampaign, saveCampaign } from "./gift-campaign.server";

vi.mock("../db.server", async () => ({
  default: (await import("../modules/gifts/__test__/memory-db")).prismaMock,
}));
vi.mock("../modules/gifts/engine.server", () => ({
  syncAll: vi.fn(async () => ({ errors: [] })),
  shopTimezone: vi.fn(async () => "Europe/London"),
}));
vi.mock("../modules/gifts/history.server", () => ({
  describeChanges: vi.fn(() => []),
  describeNew: vi.fn(() => []),
  logEvent: vi.fn(),
}));
vi.mock("../modules/gifts/scheduler.server", () => ({ rescheduleGiftTimer: vi.fn() }));

const admin = { graphql: vi.fn() };
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
});

describe("included card visibility storage", () => {
  it("keeps new and legacy campaigns visible by default", () => {
    expect(emptyCampaign().showIncludedCard).toBe(true);
    expect(rowToCampaign({ id: "legacy", presentation: "included" }).showIncludedCard).toBe(true);
  });

  it("saves, reloads and re-enables the card without changing included rules", async () => {
    const c = {
      ...emptyCampaign(), presentation: "included" as const,
      showIncludedCard: false, notSoldSeparately: true,
      giftProducts: [{ id: "gid://shopify/Product/99", handle: "part", title: "Part", qty: 2 }],
    };
    expect((await saveCampaign(admin, "s", c)).ok).toBe(true);
    const saved = (await getCampaign("s", c.id))!;
    expect(saved).toMatchObject({
      showIncludedCard: false, presentation: "included", notSoldSeparately: true,
      giftProducts: [{ qty: 2 }],
    });
    await saveCampaign(admin, "s", { ...saved, showIncludedCard: true });
    expect((await getCampaign("s", c.id))?.showIncludedCard).toBe(true);
  });

  it("preserves the hidden-card setting when duplicating a campaign as a draft", async () => {
    const c = { ...emptyCampaign(), presentation: "included" as const, showIncludedCard: false };
    await saveCampaign(admin, "s", c);
    const copy = await duplicateCampaign(admin, "s", c.id);
    expect(copy.ok).toBe(true);
    expect(await getCampaign("s", copy.id!)).toMatchObject({
      draft: true, presentation: "included", showIncludedCard: false,
    });
  });
});
