-- CreateEnum
CREATE TYPE "PageOrientation" AS ENUM ('PORTRAIT', 'LANDSCAPE');

-- CreateEnum
CREATE TYPE "PageSize" AS ENUM ('A4', 'LETTER');

-- AlterTable
ALTER TABLE "AuditTrail" ALTER COLUMN "timestamp" SET DEFAULT NOW();

-- AlterTable
ALTER TABLE "ElectronicSignature" ALTER COLUMN "signedAt" SET DEFAULT NOW();

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "orientation" "PageOrientation" NOT NULL DEFAULT 'LANDSCAPE',
    "pageSize" "PageSize" NOT NULL DEFAULT 'A4',
    "backgroundImagePath" TEXT,
    "logoPath" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0f766e',
    "secondaryColor" TEXT NOT NULL DEFAULT '#334155',
    "fontFamily" TEXT NOT NULL DEFAULT 'Georgia',
    "headerText" TEXT NOT NULL DEFAULT 'Certificate of Training Completion',
    "subHeaderText" TEXT NOT NULL DEFAULT 'This is to certify that',
    "bodyText" TEXT NOT NULL DEFAULT '{{employeeName}} ({{employeeId}}) has successfully completed the training {{topicName}} [{{topicCode}}] with a score of {{score}}% on {{completionDate}}.',
    "footerText" TEXT NOT NULL DEFAULT 'Certificate No: {{certificateNumber}}',
    "signatory1Name" TEXT,
    "signatory1Title" TEXT,
    "signatory1SignatureImagePath" TEXT,
    "signatory2Name" TEXT,
    "signatory2Title" TEXT,
    "signatory2SignatureImagePath" TEXT,
    "showBorder" BOOLEAN NOT NULL DEFAULT true,
    "borderColor" TEXT NOT NULL DEFAULT '#0f766e',
    "borderWidth" INTEGER NOT NULL DEFAULT 6,
    "watermarkText" TEXT,
    "showWatermark" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificateTemplate_certificateType_idx" ON "CertificateTemplate"("certificateType");
