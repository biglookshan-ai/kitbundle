-- Gifts step 2b: pick k of N gifts, and a rules version for legacy All mode.
ALTER TABLE "GiftCampaign" ADD COLUMN "chooseCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GiftCampaign" ADD COLUMN "rulesVersion" INTEGER NOT NULL DEFAULT 1;
