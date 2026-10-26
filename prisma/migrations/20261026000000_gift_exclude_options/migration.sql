-- Variant-level carve-out: option values (e.g. mirrorless mounts) whose variants don't trigger
ALTER TABLE "GiftCampaign" ADD COLUMN "excludeOptionsJson" TEXT NOT NULL DEFAULT '[]';
