-- izLearn initial migration (hand-authored, GxP-compliant).
-- Enables pgcrypto, creates all tables/enums/indexes, and installs the
-- AuditTrail / ElectronicSignature immutability triggers (21 CFR Part 11 §11.10(e)).

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Enum types
-- ============================================================
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'EXTERNAL', 'CONTRACTOR');
CREATE TYPE "UserRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');
CREATE TYPE "TrainingType" AS ENUM ('CLASSROOM', 'E_LEARNING', 'OJT', 'OFFLINE', 'INDUCTION', 'REFRESHER', 'WORKSHOP');
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE_SINGLE', 'MULTIPLE_CHOICE_MULTI', 'MATCH_THE_WORDS', 'FILL_IN_THE_BLANKS', 'TRUE_FALSE');
CREATE TYPE "ScheduleStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AssignmentType" AS ENUM ('COURSE_SPECIFIC', 'PERSON_SPECIFIC', 'ROLE_SPECIFIC', 'TNI_BASED');
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'BLOCKED', 'WAIVED');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');
CREATE TYPE "AttendanceMethod" AS ENUM ('MANUAL', 'EXCEL_UPLOAD', 'ONLINE_AUTO');
CREATE TYPE "CertificateType" AS ENUM ('TRAINING', 'INDUCTION');
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'OBSOLETE', 'REJECTED');
CREATE TYPE "TNIStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- ============================================================
-- Tables
-- ============================================================
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "windowsUsername" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "signaturePasswordHash" TEXT,
    "userType" "UserType" NOT NULL,
    "departmentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserCreationRequest" (
    "id" TEXT NOT NULL,
    "userType" "UserType" NOT NULL,
    "fullName" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "windowsUsername" TEXT NOT NULL,
    "email" TEXT,
    "departmentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "roleIds" JSONB NOT NULL,
    "remarks" TEXT,
    "status" "UserRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionRemarks" TEXT,
    "signatureId" TEXT,
    "createdUserId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "UserCreationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingTopic" (
    "id" TEXT NOT NULL,
    "topicCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "trainingType" "TrainingType" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "passingScorePercent" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "refresherIntervalMonths" INTEGER,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "parentTopicId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "TrainingTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingMaterial" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrentVersion" BOOLEAN NOT NULL DEFAULT true,
    "isObsolete" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "TrainingMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "topicVersion" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "options" JSONB,
    "correctAnswer" JSONB NOT NULL,
    "explanation" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSchedule" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "trainerId" TEXT NOT NULL,
    "trainingType" "TrainingType" NOT NULL,
    "methodology" TEXT,
    "venue" TEXT,
    "maxTrainees" INTEGER,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PLANNED',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "TrainingSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "assignedBy" TEXT NOT NULL,
    "assignmentType" "AssignmentType" NOT NULL,
    "dueDate" TIMESTAMP(3),
    "refresherDueDate" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "tniId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedBy" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "AttendanceMethod" NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OjtRecord" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "evaluationDate" TIMESTAMP(3) NOT NULL,
    "evaluationScore" DOUBLE PRECISION NOT NULL,
    "remarks" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "OjtRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfflineTrainingRecord" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "trainerName" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "trainingDate" TIMESTAMP(3) NOT NULL,
    "traineeIds" JSONB NOT NULL,
    "attendanceSheet" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "OfflineTrainingRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "topicVersion" INTEGER NOT NULL,
    "assignmentId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "isPassed" BOOLEAN,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB,
    "questionsUsed" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filePath" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "signatureId" TEXT,
    "parentJdId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JDTemplate" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "JDTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonalDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "PersonalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TNI" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "identifiedBy" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "TNIStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "signatureId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "TNI_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackForm" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "FeedbackForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedbackResponse" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "responses" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "FeedbackResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "targetRoles" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailNotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "toEmail" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "EmailNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditTrail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userFullName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reasonForChange" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "AuditTrail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectronicSignature" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userFullName" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "ipAddress" TEXT,
    CONSTRAINT "ElectronicSignature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- ============================================================
-- Unique & secondary indexes
-- ============================================================
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
CREATE UNIQUE INDEX "User_windowsUsername_key" ON "User"("windowsUsername");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
CREATE INDEX "User_locationId_idx" ON "User"("locationId");
CREATE INDEX "User_isDeleted_idx" ON "User"("isDeleted");

CREATE UNIQUE INDEX "Role_roleName_key" ON "Role"("roleName");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "Department_locationId_idx" ON "Department"("locationId");
CREATE INDEX "UserCreationRequest_status_idx" ON "UserCreationRequest"("status");

CREATE UNIQUE INDEX "TrainingTopic_topicCode_key" ON "TrainingTopic"("topicCode");
CREATE INDEX "TrainingTopic_parentTopicId_idx" ON "TrainingTopic"("parentTopicId");
CREATE INDEX "TrainingTopic_isDeleted_idx" ON "TrainingTopic"("isDeleted");

CREATE INDEX "TrainingMaterial_topicId_idx" ON "TrainingMaterial"("topicId");
CREATE INDEX "Question_topicId_topicVersion_idx" ON "Question"("topicId","topicVersion");
CREATE INDEX "TrainingSchedule_topicId_idx" ON "TrainingSchedule"("topicId");
CREATE INDEX "TrainingSchedule_scheduledDate_idx" ON "TrainingSchedule"("scheduledDate");

CREATE INDEX "TrainingAssignment_userId_idx" ON "TrainingAssignment"("userId");
CREATE INDEX "TrainingAssignment_topicId_idx" ON "TrainingAssignment"("topicId");
CREATE INDEX "TrainingAssignment_scheduleId_idx" ON "TrainingAssignment"("scheduleId");
CREATE INDEX "TrainingAssignment_status_idx" ON "TrainingAssignment"("status");

CREATE INDEX "Attendance_scheduleId_idx" ON "Attendance"("scheduleId");
CREATE INDEX "Attendance_userId_idx" ON "Attendance"("userId");
CREATE INDEX "OjtRecord_userId_idx" ON "OjtRecord"("userId");
CREATE INDEX "OjtRecord_topicId_idx" ON "OjtRecord"("topicId");
CREATE INDEX "OfflineTrainingRecord_topicId_idx" ON "OfflineTrainingRecord"("topicId");

CREATE INDEX "AssessmentAttempt_userId_idx" ON "AssessmentAttempt"("userId");
CREATE INDEX "AssessmentAttempt_topicId_idx" ON "AssessmentAttempt"("topicId");
CREATE INDEX "AssessmentAttempt_assignmentId_idx" ON "AssessmentAttempt"("assignmentId");

CREATE UNIQUE INDEX "Certificate_certificateNumber_key" ON "Certificate"("certificateNumber");
CREATE INDEX "Certificate_userId_idx" ON "Certificate"("userId");
CREATE INDEX "Certificate_topicId_idx" ON "Certificate"("topicId");

CREATE INDEX "JobDescription_userId_idx" ON "JobDescription"("userId");
CREATE INDEX "JobDescription_departmentId_roleId_idx" ON "JobDescription"("departmentId","roleId");
CREATE UNIQUE INDEX "JDTemplate_departmentId_roleId_key" ON "JDTemplate"("departmentId","roleId");
CREATE INDEX "PersonalDocument_userId_idx" ON "PersonalDocument"("userId");

CREATE INDEX "TNI_userId_idx" ON "TNI"("userId");
CREATE INDEX "TNI_status_idx" ON "TNI"("status");
CREATE INDEX "FeedbackForm_topicId_idx" ON "FeedbackForm"("topicId");
CREATE INDEX "FeedbackResponse_formId_idx" ON "FeedbackResponse"("formId");

CREATE INDEX "EmailNotificationLog_status_idx" ON "EmailNotificationLog"("status");
CREATE INDEX "EmailNotificationLog_userId_idx" ON "EmailNotificationLog"("userId");

CREATE INDEX "AuditTrail_userId_idx" ON "AuditTrail"("userId");
CREATE INDEX "AuditTrail_entityType_entityId_idx" ON "AuditTrail"("entityType","entityId");
CREATE INDEX "AuditTrail_action_idx" ON "AuditTrail"("action");
CREATE INDEX "AuditTrail_timestamp_idx" ON "AuditTrail"("timestamp");

CREATE INDEX "ElectronicSignature_recordType_recordId_idx" ON "ElectronicSignature"("recordType","recordId");
CREATE INDEX "ElectronicSignature_userId_idx" ON "ElectronicSignature"("userId");

CREATE UNIQUE INDEX "UserSession_refreshToken_key" ON "UserSession"("refreshToken");
CREATE UNIQUE INDEX "UserSession_sessionId_key" ON "UserSession"("sessionId");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX "PasswordHistory_userId_idx" ON "PasswordHistory"("userId");

-- ============================================================
-- Immutability triggers (21 CFR Part 11 §11.10(e), EU Annex 11 §10)
-- AuditTrail is INSERT-ONLY. ElectronicSignature records are permanent.
-- These raise an exception on ANY attempt to UPDATE or DELETE.
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_record_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Immutable record (21 CFR Part 11): % on table % is not permitted', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_trail_immutable
    BEFORE UPDATE OR DELETE ON "AuditTrail"
    FOR EACH ROW EXECUTE FUNCTION prevent_record_mutation();

CREATE TRIGGER electronic_signature_immutable
    BEFORE UPDATE OR DELETE ON "ElectronicSignature"
    FOR EACH ROW EXECUTE FUNCTION prevent_record_mutation();
