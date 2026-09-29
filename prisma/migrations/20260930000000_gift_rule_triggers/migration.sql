-- Gifts step 2a: rule-based triggers + exclusions, and a sync log.
ALTER TABLE "GiftCampaign" ADD COLUMN "triggerTagsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "GiftCampaign" ADD COLUMN "triggerVendorsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "GiftCampaign" ADD COLUMN "triggerTypesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "GiftCampaign" ADD COLUMN "allProducts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GiftCampaign" ADD COLUMN "excludeTagsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "GiftCampaign" ADD COLUMN "excludeProductsJson" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "GiftSyncLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftSyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GiftSyncLog_shop_createdAt_idx" ON "GiftSyncLog"("shop", "createdAt");

CREATE TABLE "GiftStamp" (
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GiftStamp_pkey" PRIMARY KEY ("shop","productId")
);
