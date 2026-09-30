-- Gifts step 3: draft state + in-app scheduler bookkeeping.
ALTER TABLE "GiftCampaign" ADD COLUMN "draft" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GiftSchedulerState" (
    "shop" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastFullAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastResult" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftSchedulerState_pkey" PRIMARY KEY ("shop")
);
