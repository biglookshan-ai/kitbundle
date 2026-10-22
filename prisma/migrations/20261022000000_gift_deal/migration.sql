-- Gifts: add-on deal campaigns (reward products get a % off instead of free).
ALTER TABLE "GiftCampaign" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'gift';
ALTER TABLE "GiftCampaign" ADD COLUMN "dealPercent" INTEGER NOT NULL DEFAULT 10;
