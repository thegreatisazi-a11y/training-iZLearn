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
]);
export type AssignmentStatus = z.infer<typeof assignmentStatus>;

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

/** Derive the 5 legacy flags from a granular verb set (so existing guards keep working). */
export function deriveLegacyFlags(flags: Record<string, boolean | undefined>): {
  read: boolean;
  write: boolean;
  approve: boolean;
  print: boolean;
  export: boolean;
} {
  const f = (k: string) => flags[k] === true;
  return {
    read: f('view') || f('read'),
    write: f('create') || f('edit') || f('archive') || f('revise') || f('assign') || f('write'),
    approve: f('review') || f('approve'),
    print: f('print'),
    export: f('export'),
  };
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
