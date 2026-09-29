-- Gifts step 2c: overlap handling (priority + exclusive).
ALTER TABLE "GiftCampaign" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GiftCampaign" ADD COLUMN "exclusive" BOOLEAN NOT NULL DEFAULT false;
