-- Phase 4: make BundleTopic membership soft-deletable (non-negotiable soft-delete rule)
-- Applied: 2026-06-09

ALTER TABLE "BundleTopic" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BundleTopic" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
