-- Bundle: assign-to-designations + a default due date for assignment.
-- Applied: 2026-06-09

ALTER TABLE "TopicBundle" ADD COLUMN "designationIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "TopicBundle" ADD COLUMN "dueDate" TIMESTAMPTZ;
