import { z } from 'zod';

/** All enums mirror the Prisma schema exactly (single source of truth for values). */

export const userType = z.enum(['INTERNAL', 'EXTERNAL', 'CONTRACTOR']);
export type UserType = z.infer<typeof userType>;

export const trainingType = z.enum([
  'SOP',
  'ONLINE',
  'CLASSROOM',
  'E_LEARNING',
  'OJT',
  'OFFLINE',
  'INDUCTION',
  'REFRESHER',
  'WORKSHOP',
  // CR-58: additional self-paced / delivery types
  'SELF_READ',
  'SELF_READ_EVALUATION',
  'QUIZ',
  'VIDEO',
  'REMOTE',
]);
export type TrainingType = z.infer<typeof trainingType>;

export const questionType = z.enum([
  'MULTIPLE_CHOICE_SINGLE',
  'MULTIPLE_CHOICE_MULTI',
  'MATCH_THE_WORDS',
  'FILL_IN_THE_BLANKS',
  'TRUE_FALSE',
]);
export type QuestionType = z.infer<typeof questionType>;

export const scheduleStatus = z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type ScheduleStatus = z.infer<typeof scheduleStatus>;

export const assignmentType = z.enum([
  'COURSE_SPECIFIC',
  'PERSON_SPECIFIC',
  'ROLE_SPECIFIC',
  'TNI_BASED',
]);
export type AssignmentType = z.infer<typeof assignmentType>;

export const assignmentStatus = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'OVERDUE',
  'BLOCKED',
  'WAIVED',
  'DEFERRED', // CR-57: assign-later — hidden from the trainee until activated
]);
export type AssignmentStatus = z.infer<typeof assignmentStatus>;

/** CR-15/16: user onboarding lifecycle / release stage. */
export const releaseStage = z.enum(['ONBOARDING', 'READY_FOR_RELEASE', 'RELEASED']);
export type ReleaseStage = z.infer<typeof releaseStage>;

export const attendanceStatus = z.enum(['PRESENT', 'ABSENT']);
export type AttendanceStatus = z.infer<typeof attendanceStatus>;

export const attendanceMethod = z.enum(['MANUAL', 'EXCEL_UPLOAD', 'ONLINE_AUTO']);
export type AttendanceMethod = z.infer<typeof attendanceMethod>;

export const certificateType = z.enum(['TRAINING', 'INDUCTION']);
export type CertificateType = z.infer<typeof certificateType>;

export const docStatus = z.enum(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'OBSOLETE', 'REJECTED']);
export type DocStatus = z.infer<typeof docStatus>;

export const tniStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type TNIStatus = z.infer<typeof tniStatus>;

/** Lifecycle status of a training topic. Draft/under-review/archived are hidden from trainees. */
export const topicStatus = z.enum(['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'ARCHIVED']);
export type TopicStatus = z.infer<typeof topicStatus>;

export const emailStatus = z.enum(['QUEUED', 'SENT', 'FAILED']);
export type EmailStatus = z.infer<typeof emailStatus>;

/** Controlled vocabulary for electronic-signature meaning (21 CFR Part 11 §11.50). */
export const signatureMeaning = z.enum([
  'Approved',
  'Reviewed',
  'Rejected',
  'Performed',
  'Acknowledged',
]);
export type SignatureMeaning = z.infer<typeof signatureMeaning>;

/**
 * RBAC permission verbs.
 *
 * `PERMISSION_VERBS` are the 10 granular, GMP-aligned verbs surfaced in the Roles
 * matrix UI. For backward compatibility the legacy aliases `read`/`write` are also
 * accepted by route guards (approve/print/export are shared between both models).
 * On save/seed the legacy keys are DERIVED from the granular verbs
 * (see `deriveLegacyFlags`); on read, a missing granular verb FALLS BACK to its
 * legacy equivalent (see `LEGACY_FALLBACK`) so pre-existing custom roles keep working.
 */
export const PERMISSION_VERBS = [
  'view',
  'create',
  'edit',
  'archive',
  'revise',
  'assign',
  'review',
  'approve',
  'print',
  'export',
] as const;
export type PermissionVerb = (typeof PERMISSION_VERBS)[number];

/** All accepted permission keys: the 10 verbs plus the legacy `read`/`write` aliases. */
export const permissionAction = z.enum([...PERMISSION_VERBS, 'read', 'write']);
export type PermissionAction = z.infer<typeof permissionAction>;

/** Granular verb -> legacy key, used as a fallback when reading older role matrices. */
export const LEGACY_FALLBACK: Record<PermissionVerb, 'read' | 'write' | 'approve' | 'print' | 'export'> = {
  view: 'read',
  create: 'write',
  edit: 'write',
  archive: 'write',
  revise: 'write',
  assign: 'write',
  review: 'approve',
  approve: 'approve',
  print: 'print',
  export: 'export',
};

/**
 * Self-service / display actions that must NOT grant any module-level legacy
 * capability (e.g. acknowledging your own JD must never imply approve/write on the
 * Job Description module). They are enforced by ownership checks, not the matrix.
 */
const NEUTRAL_ACTIONS = new Set(['acknowledge', 'configure_widgets']);
/** Only these explicitly grant the legacy "approve" capability that routes check. */
const APPROVE_ACTIONS = new Set(['approve', 'review']);

/**
 * Derive the 5 legacy flags (read/write/approve/print/export) from ANY granted
 * action set (the curated per-module catalog actions). Existing route guards check
 * these legacy flags (or the granular verb directly), so enforcement is preserved:
 *   - any "view*" action          → read
 *   - approve / review            → approve
 *   - print / export              → print / export
 *   - every other granted action  → write
 *   - acknowledge / configure_*   → neutral (no legacy capability)
 */
export function deriveLegacyFlags(flags: Record<string, boolean | undefined>): {
  read: boolean;
  write: boolean;
  approve: boolean;
  print: boolean;
  export: boolean;
} {
  let read = false;
  let write = false;
  let approve = false;
  let print = false;
  let exp = false;
  for (const [k, v] of Object.entries(flags)) {
    if (v !== true) continue;
    if (k === 'read' || k === 'write') continue; // skip the derived keys themselves
    if (NEUTRAL_ACTIONS.has(k)) continue;
    if (k === 'print') print = true;
    else if (k === 'export') exp = true;
    else if (k === 'view' || k.startsWith('view')) read = true;
    else if (APPROVE_ACTIONS.has(k)) approve = true;
    else write = true;
  }
  return { read, write, approve, print, export: exp };
}

/** Canonical list of RBAC module keys used in the permission matrix. */
export const PERMISSION_MODULES = [
  'dashboard',
  'userManagement',
  'roleManagement',
  'masterSetup',
  'courseManagement',
  'topicVersionHistory',
  'bundleManagement',
  'trainingAssignment',
  'materialManagement',
  'jobDescription',
  'tni',
  'cv',
  'team',
  'scheduling',
  'attendance',
  'assessments',
  'questionBank',
  'certificates',
  'feedback',
  'announcements',
  'reports',
  'auditTrail',
  'systemConfig',
  'backup',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const permissionModule = z.enum(PERMISSION_MODULES);

/** Audit action vocabulary (kept in sync with the AuditTrail service). */
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'SOFT_DELETE',
  'APPROVE',
  'REJECT',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'SESSION_TERMINATED',
  'SESSION_LOCKED',
  'EXPORT',
  'PRINT',
  'ESIGN',
  'ACKNOWLEDGE',
  'CONFIG_CHANGE',
  'PERMISSION_CHANGE',
  'FILE_UPLOAD',
  'FILE_DOWNLOAD',
  'BACKUP_TRIGGERED',
  'AUTO_DEACTIVATED_AD_SYNC',
  'ASSESSMENT_SUBMITTED',
  'CERTIFICATE_GENERATED',
  'ACCESS_DENIED',
  'RATE_LIMITED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
