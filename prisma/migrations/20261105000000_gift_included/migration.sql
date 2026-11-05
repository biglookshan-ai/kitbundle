-- Gifts: "included" presentation + "not sold separately" guard.
ALTER TABLE "GiftCampaign" ADD COLUMN "presentation" TEXT NOT NULL DEFAULT 'gift';
ALTER TABLE "GiftCampaign" ADD COLUMN "notSoldSeparately" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GiftOnlyMark" (
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "seoHiddenSet" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GiftOnlyMark_pkey" PRIMARY KEY ("shop","productId")
);
