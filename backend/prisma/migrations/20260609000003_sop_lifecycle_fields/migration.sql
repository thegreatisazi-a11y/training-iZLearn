-- Step 1: SOP/GMP lifecycle fields, per-topic question limit, bundle user targeting,
-- certificate version traceability, UNDER_REVIEW topic status.
-- Applied: 2026-06-09

-- New topic status value (PG15 allows ADD VALUE; idempotent guard)
ALTER TYPE "TopicStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';

-- TrainingTopic: SOP/document control + lifecycle metadata
ALTER TABLE "TrainingTopic" ADD COLUMN "sopNumber" TEXT;
ALTER TABLE "TrainingTopic" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "TrainingTopic" ADD COLUMN "questionLimit" INTEGER;
ALTER TABLE "TrainingTopic" ADD COLUMN "effectiveDate" TIMESTAMPTZ;
ALTER TABLE "TrainingTopic" ADD COLUMN "reviewDate" TIMESTAMPTZ;
ALTER TABLE "TrainingTopic" ADD COLUMN "supersededByTopicId" TEXT;

-- TopicBundle: assign to specific users (in addition to departments/roles)
ALTER TABLE "TopicBundle" ADD COLUMN "userIds" JSONB NOT NULL DEFAULT '[]';

-- Certificate: record the completed topic version
ALTER TABLE "Certificate" ADD COLUMN "topicVersion" INTEGER;
