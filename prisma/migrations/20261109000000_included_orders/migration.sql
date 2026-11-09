-- CreateTable
CREATE TABLE "IncludedOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT NOT NULL DEFAULT '',
    "campaignIdsJson" TEXT NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncludedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncludedOrder_shop_orderId_key" ON "IncludedOrder"("shop", "orderId");

-- CreateIndex
CREATE INDEX "IncludedOrder_shop_createdAt_idx" ON "IncludedOrder"("shop", "createdAt");
