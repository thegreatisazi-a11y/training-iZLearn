-- TrainingMaterial: staged (pending) files on published topics + archive metadata.
-- A file added/replaced/attached on a PUBLISHED topic is staged (isStaged=true) and
-- stays inert until the topic is revised. On revise, superseded files are stamped
-- with archivedAt/archivedBy/changeReason for the Archived Materials view.
-- Idempotent (IF NOT EXISTS) so it is safe to apply regardless of prior state.
-- Applied: 2026-06-09

ALTER TABLE "TrainingMaterial" ADD COLUMN IF NOT EXISTS "isStaged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrainingMaterial" ADD COLUMN IF NOT EXISTS "replacesMaterialId" TEXT;
ALTER TABLE "TrainingMaterial" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ;
ALTER TABLE "TrainingMaterial" ADD COLUMN IF NOT EXISTS "archivedBy" TEXT;
ALTER TABLE "TrainingMaterial" ADD COLUMN IF NOT EXISTS "changeReason" TEXT;

CREATE INDEX IF NOT EXISTS "TrainingMaterial_isStaged_idx" ON "TrainingMaterial"("isStaged");
