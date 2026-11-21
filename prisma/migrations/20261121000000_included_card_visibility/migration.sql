-- Product-page display only; included parts keep their cart / checkout rules.
ALTER TABLE "GiftCampaign" ADD COLUMN "showIncludedCard" BOOLEAN NOT NULL DEFAULT true;
