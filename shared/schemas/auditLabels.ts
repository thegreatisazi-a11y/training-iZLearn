/** Labels used by the audit table and its server-side text search. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  TrainingTopic: 'Course',
  TopicBundle: 'Course Bundle',
  TrainingMaterial: 'Training Material',
  TrainingAssignment: 'Training Assignment',
  TrainingSchedule: 'Training Schedule',
  AssessmentAttempt: 'Assessment Attempt',
  Question: 'Question',
  RetakeRequest: 'Retake Request',
  Certificate: 'Certificate',
  CertificateTemplate: 'Certificate Template',
  CurriculumVitae: 'CV',
  JobDescription: 'Job Description',
  PersonalDocument: 'Personal Document',
  OfflineTrainingRecord: 'Offline Training Record',
  OjtRecord: 'OJT Record',
  Attendance: 'Attendance',
  TNI: 'Training Needs (TNI)',
  User: 'User',
  UserRole: 'User Role',
  UserSession: 'User Session',
  UserCreationRequest: 'User Creation Request',
  Role: 'Role',
  Module: 'Permission Check',
  Auth: 'Authentication',
  Network: 'Network Restriction',
  Report: 'Report',
  Backup: 'Backup',
  AuditTrail: 'Audit Trail',
};

export const auditEntityLabel = (value: string): string =>
  AUDIT_ENTITY_LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2');
