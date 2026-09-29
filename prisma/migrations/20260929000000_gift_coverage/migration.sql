-- CreateTable
CREATE TABLE "GiftCoverage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "viaJson" TEXT NOT NULL DEFAULT '[]',
    "title" TEXT NOT NULL DEFAULT '',
    "handle" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "vendor" TEXT NOT NULL DEFAULT '',
    "productType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "totalInventory" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCoverage_shop_campaignId_productId_role_key" ON "GiftCoverage"("shop", "campaignId", "productId", "role");

-- CreateIndex
CREATE INDEX "GiftCoverage_shop_role_idx" ON "GiftCoverage"("shop", "role");

-- CreateIndex
CREATE INDEX "GiftCoverage_shop_productId_idx" ON "GiftCoverage"("shop", "productId");
