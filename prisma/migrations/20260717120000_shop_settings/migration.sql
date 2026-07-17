-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "tagOffers" BOOLEAN NOT NULL DEFAULT false,
    "offerTag" TEXT NOT NULL DEFAULT 'kitbundle',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);
