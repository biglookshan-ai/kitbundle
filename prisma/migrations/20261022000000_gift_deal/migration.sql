-- Gifts: add-on deal campaigns (reward products get a % off instead of free).
ALTER TABLE "GiftCampaign" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'gift';
ALTER TABLE "GiftCampaign" ADD COLUMN "dealPercent" INTEGER NOT NULL DEFAULT 10;
-- Deal rewards can also be whole collections (every product in them, every variant).
ALTER TABLE "GiftCampaign" ADD COLUMN "rewardCollectionsJson" TEXT NOT NULL DEFAULT '[]';
