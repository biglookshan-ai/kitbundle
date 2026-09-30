-- Gifts: the gift pool (products set aside to give away).
CREATE TABLE "GiftPoolItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "handle" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftPoolItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftPoolItem_shop_productId_key" ON "GiftPoolItem"("shop", "productId");
CREATE INDEX "GiftPoolItem_shop_idx" ON "GiftPoolItem"("shop");
