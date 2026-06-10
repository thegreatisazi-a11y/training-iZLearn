-- Phase 1: Designation master, topic draft/publish + version history, topic bundles
-- Applied: 2026-06-09

-- ============================================================
-- Enums
-- ============================================================
CREATE TYPE "TopicStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- ============================================================
-- 1.1 Designation master + designationId on User / UserCreationRequest
-- ============================================================
ALTER TABLE "User" ADD COLUMN "designationId" TEXT;
ALTER TABLE "UserCreationRequest" ADD COLUMN "designationId" TEXT;

CREATE TABLE "DesignationMaster" (
    "id"          TEXT        NOT NULL,
    "code"        TEXT        NOT NULL,
    "displayName" TEXT        NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN     NOT NULL DEFAULT true,
    "isDeleted"   BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy"   TEXT        NOT NULL,
    CONSTRAINT "DesignationMaster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesignationMaster_code_key" ON "DesignationMaster"("code");

-- Seed a few example designations
INSERT INTO "DesignationMaster"
    ("id", "code", "displayName", "description", "isActive", "isDeleted", "createdAt", "updatedAt", "createdBy")
VALUES
    (gen_random_uuid(), 'OPERATOR',          'Operator',            'Production / shop-floor operator',          true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'SUPERVISOR',        'Supervisor',          'Line / shift supervisor',                   true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'EXECUTIVE',         'Executive',           'Department executive',                      true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'OFFICER',           'Officer',             'Officer-level staff',                       true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'MANAGER',           'Manager',             'Department / functional manager',           true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'QA_ANALYST',        'QA Analyst',          'Quality assurance analyst',                 true, false, NOW(), NOW(), 'SYSTEM');

-- ============================================================
-- 1.2 Topic: draft/publish status, manual topic number, mandatory reading time
-- ============================================================
ALTER TABLE "TrainingTopic" ADD COLUMN "topicNumber" TEXT;
ALTER TABLE "TrainingTopic" ADD COLUMN "materialViewSeconds" INTEGER;
ALTER TABLE "TrainingTopic" ADD COLUMN "status" "TopicStatus" NOT NULL DEFAULT 'DRAFT';

-- Existing topics predate the draft/publish workflow → treat them as PUBLISHED so
-- they remain visible/assignable exactly as before (no behaviour change for live data).
UPDATE "TrainingTopic" SET "status" = 'PUBLISHED' WHERE "isDeleted" = false;

CREATE INDEX "TrainingTopic_status_idx" ON "TrainingTopic"("status");

-- ============================================================
-- 1.3 Topic version history
-- ============================================================
CREATE TABLE "TopicVersionHistory" (
    "id"                TEXT        NOT NULL,
    "topicId"           TEXT        NOT NULL,
    "version"           INTEGER     NOT NULL,
    "changedBy"         TEXT        NOT NULL,
    "reason"            TEXT,
    "note"              TEXT,
    "materialsSnapshot" JSONB       NOT NULL,
    "questionsSnapshot" JSONB       NOT NULL,
    "changedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "isDeleted"         BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy"         TEXT        NOT NULL,
    CONSTRAINT "TopicVersionHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TopicVersionHistory_topicId_idx" ON "TopicVersionHistory"("topicId");

-- ============================================================
-- 1.4 Topic bundles
-- ============================================================
CREATE TABLE "TopicBundle" (
    "id"            TEXT        NOT NULL,
    "name"          TEXT        NOT NULL,
    "description"   TEXT,
    "departmentIds" JSONB       NOT NULL DEFAULT '[]',
    "roleIds"       JSONB       NOT NULL DEFAULT '[]',
    "isActive"      BOOLEAN     NOT NULL DEFAULT true,
    "isDeleted"     BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy"     TEXT        NOT NULL,
    CONSTRAINT "TopicBundle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BundleTopic" (
    "bundleId"  TEXT        NOT NULL,
    "topicId"   TEXT        NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy" TEXT        NOT NULL,
    CONSTRAINT "BundleTopic_pkey" PRIMARY KEY ("bundleId", "topicId")
);
CREATE INDEX "BundleTopic_topicId_idx" ON "BundleTopic"("topicId");
