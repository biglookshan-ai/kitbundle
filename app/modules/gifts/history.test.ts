import { describe, expect, it, vi } from "vitest";
vi.mock("../../db.server", () => ({ default: {} }));
import { describeChanges } from "./history.server";
import { emptyCampaign } from "../../models/gift-campaign";

describe("campaign history", () => {
  it("summarises status, dates, gifts and quantities in plain English", () => {
    const a = { ...emptyCampaign(), title: "Smart Fusion gifts", giftProducts: [{ id: "g1", title: "Lens Cloth", handle: "lc", qty: 1 }] };
    const b = {
      ...a,
      enabled: false,
      endsAt: "2026-10-20T09:00:00.000Z",
      triggerTags: ["sale"],
      giftProducts: [
        { id: "g1", title: "Lens Cloth", handle: "lc", qty: 2 },
        { id: "g2", title: "Rod Ring", handle: "rr", qty: 1 },
      ],
    };
    expect(describeChanges(a, b, "Europe/London")).toEqual([
      "Paused",
      "End set to 20 Oct 2026, 10:00",
      "Tag filters added: sale",
      "Gifts added: Rod Ring",
      "Lens Cloth quantity 1 → 2",
    ]);
    expect(describeChanges(a, a, "Europe/London")).toEqual([]);
  });
});
