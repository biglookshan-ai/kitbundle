-- Gifts: per-campaign change history.
CREATE TABLE "GiftCampaignEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftCampaignEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GiftCampaignEvent_shop_campaignId_createdAt_idx" ON "GiftCampaignEvent"("shop", "campaignId", "createdAt");
