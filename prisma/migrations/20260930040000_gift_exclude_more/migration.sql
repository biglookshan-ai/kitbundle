-- Gifts: exclude by collection, brand and product type too.
ALTER TABLE "GiftCampaign" ADD COLUMN "excludeCollectionsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "GiftCampaign" ADD COLUMN "excludeVendorsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "GiftCampaign" ADD COLUMN "excludeTypesJson" TEXT NOT NULL DEFAULT '[]';
