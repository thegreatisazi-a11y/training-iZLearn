-- SOP/Online training types, per-material reading time + server-side view log,
-- topic designation/role mapping + per-course assessment toggles.
-- Applied: 2026-06-09

-- New training types (PG15 allows ADD VALUE; idempotent guards)
ALTER TYPE "TrainingType" ADD VALUE IF NOT EXISTS 'SOP';
ALTER TYPE "TrainingType" ADD VALUE IF NOT EXISTS 'ONLINE';

-- TrainingTopic: designation/role mapping + per-course assessment toggles
ALTER TABLE "TrainingTopic" ADD COLUMN "designationId" TEXT;
ALTER TABLE "TrainingTopic" ADD COLUMN "roleId" TEXT;
ALTER TABLE "TrainingTopic" ADD COLUMN "randomizeQuestions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TrainingTopic" ADD COLUMN "showExplanations" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TrainingTopic" ADD COLUMN "blockAfterMaxAttempts" BOOLEAN NOT NULL DEFAULT true;

-- TrainingMaterial: per-material required reading/viewing time
ALTER TABLE "TrainingMaterial" ADD COLUMN "requiredViewSeconds" INTEGER;

-- Server-side material view log (enforces reading time before assessment)
CREATE TABLE "MaterialViewLog" (
    "id"              TEXT        NOT NULL,
    "userId"          TEXT        NOT NULL,
    "materialId"      TEXT        NOT NULL,
    "topicId"         TEXT        NOT NULL,
    "topicVersion"    INTEGER     NOT NULL,
    "requiredSeconds" INTEGER     NOT NULL DEFAULT 0,
    "startedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completedAt"     TIMESTAMPTZ,
    "isCompleted"     BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "MaterialViewLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MaterialViewLog_userId_materialId_topicVersion_key" ON "MaterialViewLog"("userId", "materialId", "topicVersion");
CREATE INDEX "MaterialViewLog_userId_topicId_idx" ON "MaterialViewLog"("userId", "topicId");
