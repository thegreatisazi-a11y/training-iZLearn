-- URS Gap Remediation: UR-42 (supervisor notifications), UR-102/103 (master data)
-- Applied: 2026-06-08

-- UR-42: Add direct-line-manager field to User and UserCreationRequest for supervisor training notifications
ALTER TABLE "User" ADD COLUMN "supervisorId" TEXT;
ALTER TABLE "UserCreationRequest" ADD COLUMN "supervisorId" TEXT;

-- UR-102/103: Training Type Master — admin-configurable list of training types
CREATE TABLE "TrainingTypeMaster" (
    "id"          TEXT        NOT NULL,
    "code"        TEXT        NOT NULL,
    "displayName" TEXT        NOT NULL,
    "description" TEXT,
    "isBuiltIn"   BOOLEAN     NOT NULL DEFAULT false,
    "isActive"    BOOLEAN     NOT NULL DEFAULT true,
    "isDeleted"   BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy"   TEXT        NOT NULL,
    CONSTRAINT "TrainingTypeMaster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrainingTypeMaster_code_key" ON "TrainingTypeMaster"("code");

-- Seed built-in training types (mirrors the TrainingType enum)
INSERT INTO "TrainingTypeMaster"
    ("id", "code", "displayName", "description", "isBuiltIn", "isActive", "isDeleted", "createdAt", "updatedAt", "createdBy")
VALUES
    (gen_random_uuid(), 'CLASSROOM',  'Classroom',              'Instructor-led classroom training',           true, true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'E_LEARNING', 'e-Learning',             'Online / digital self-paced learning',        true, true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'OJT',        'On-the-Job Training',    'Hands-on training in the workplace',          true, true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'OFFLINE',    'Offline Training',       'Pre-recorded or physical training materials', true, true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'INDUCTION',  'Induction',              'New employee orientation and induction',      true, true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'REFRESHER',  'Refresher',              'Periodic refresher to reinforce knowledge',   true, true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'WORKSHOP',   'Workshop',               'Collaborative workshop-based learning',       true, true, false, NOW(), NOW(), 'SYSTEM');

-- UR-102/103: Document Type Master — admin-configurable list of personal document types
CREATE TABLE "DocumentTypeMaster" (
    "id"          TEXT        NOT NULL,
    "code"        TEXT        NOT NULL,
    "displayName" TEXT        NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN     NOT NULL DEFAULT true,
    "isDeleted"   BOOLEAN     NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy"   TEXT        NOT NULL,
    CONSTRAINT "DocumentTypeMaster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentTypeMaster_code_key" ON "DocumentTypeMaster"("code");

-- Seed built-in document types
INSERT INTO "DocumentTypeMaster"
    ("id", "code", "displayName", "description", "isActive", "isDeleted", "createdAt", "updatedAt", "createdBy")
VALUES
    (gen_random_uuid(), 'SOP',           'Standard Operating Procedure', 'Documented procedures for standard operations',     true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'POLICY',        'Policy Document',              'Organisational policy documents',                    true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'PROTOCOL',      'Protocol',                     'Scientific or technical protocols',                  true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'CERTIFICATE',   'Training Certificate',         'Training completion certificates',                   true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'QUALIFICATION', 'Qualification Document',       'Employee qualification and credential documents',    true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'ID_PROOF',      'Identity Proof',               'Government-issued identity documents',               true, false, NOW(), NOW(), 'SYSTEM'),
    (gen_random_uuid(), 'OTHERS',        'Others',                       'Any other document type not listed above',           true, false, NOW(), NOW(), 'SYSTEM');
