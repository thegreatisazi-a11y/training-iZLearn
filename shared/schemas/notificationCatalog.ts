/**
 * Notification catalog — the single source of truth for the System Config →
 * Notifications & Email Templates screen. Every templated email the system can send
 * is listed here with the module it belongs to, a friendly label, the default
 * subject, and the {{variables}} available to that template. Admins can enable/disable
 * each notification and override its subject/body per module from the UI.
 */

/** The notification/email event types (must match backend EmailType). */
export const NOTIFICATION_TYPES = [
  'trainingAssigned',
  'trainingDue',
  'trainingOverdue',
  'refresherDue',
  'assessmentBlocked',
  'userRequestSubmitted',
  'userRequestDecision',
  'passwordReset',
  'jdPendingApproval',
  'jdDecision',
  'sessionTerminated',
  'announcement',
  'scheduleCreated',
  'courseRevised',
  'retakeRequested',
  'retakeDecision',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDef {
  type: NotificationType;
  /** Module/category this notification belongs to (for grouping). */
  module: string;
  moduleLabel: string;
  label: string;
  description: string;
  defaultSubject: string;
  /** Placeholders usable in the subject/body as {{name}}. */
  variables: string[];
}

const COMMON = ['orgName', 'userName'];

export const NOTIFICATION_CATALOG: NotificationDef[] = [
  // ---- Training / Assignments ----
  { type: 'trainingAssigned', module: 'trainingAssignment', moduleLabel: 'Training Assignments', label: 'Training Assigned', description: 'Sent to a trainee when a training/course is assigned to them.', defaultSubject: 'New training assigned: {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'dueDate'] },
  { type: 'trainingDue', module: 'trainingAssignment', moduleLabel: 'Training Assignments', label: 'Training Due Reminder', description: 'Reminder sent to a trainee as a training due date approaches.', defaultSubject: 'Reminder: training due — {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'dueDate'] },
  { type: 'trainingOverdue', module: 'trainingAssignment', moduleLabel: 'Training Assignments', label: 'Training Overdue', description: 'Sent when a training assignment passes its due date.', defaultSubject: 'OVERDUE: training — {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'dueDate'] },
  { type: 'refresherDue', module: 'trainingAssignment', moduleLabel: 'Training Assignments', label: 'Refresher Due', description: 'Sent when a periodic refresher for a course becomes due.', defaultSubject: 'Refresher due: {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'dueDate'] },
  { type: 'courseRevised', module: 'courseManagement', moduleLabel: 'Courses', label: 'Course Revised', description: 'Sent to assigned trainees when a course is revised to a new version.', defaultSubject: 'Training course revised: {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'reason'] },
  { type: 'scheduleCreated', module: 'scheduling', moduleLabel: 'Scheduling', label: 'Training Scheduled', description: 'Sent to trainees when a classroom/OJT session is scheduled.', defaultSubject: 'Training scheduled: {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'scheduledDate', 'venue'] },

  // ---- Assessments ----
  { type: 'assessmentBlocked', module: 'assessments', moduleLabel: 'Assessments', label: 'Assessment Blocked', description: 'Sent when a trainee is blocked after reaching the maximum attempts.', defaultSubject: 'Assessment blocked: {{topicTitle}}', variables: [...COMMON, 'topicTitle'] },
  { type: 'retakeRequested', module: 'assessments', moduleLabel: 'Assessments', label: 'Retake Requested', description: 'Sent to a supervisor when a trainee requests an assessment retake.', defaultSubject: 'Retake request: {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'justification'] },
  { type: 'retakeDecision', module: 'assessments', moduleLabel: 'Assessments', label: 'Retake Decision', description: 'Sent to a trainee when their retake request is approved/rejected.', defaultSubject: 'Your retake request was {{decision}}: {{topicTitle}}', variables: [...COMMON, 'topicTitle', 'decision', 'remarks'] },

  // ---- Users & Access ----
  { type: 'userRequestSubmitted', module: 'userManagement', moduleLabel: 'Users', label: 'User Request Submitted', description: 'Sent to approvers when a new user-creation request is submitted.', defaultSubject: 'New user creation request awaiting approval', variables: [...COMMON, 'fullName', 'employeeId', 'requestedBy'] },
  { type: 'userRequestDecision', module: 'userManagement', moduleLabel: 'Users', label: 'User Request Decision', description: 'Sent when a user-creation request is approved/rejected.', defaultSubject: 'Your user request was {{decision}}', variables: [...COMMON, 'decision'] },
  { type: 'passwordReset', module: 'userManagement', moduleLabel: 'Users', label: 'Password Reset', description: 'Sent to a user when their password is reset by an administrator.', defaultSubject: 'Your izLearn password has been reset', variables: [...COMMON, 'tempPassword'] },
  { type: 'sessionTerminated', module: 'userManagement', moduleLabel: 'Users', label: 'Session Terminated', description: 'Sent when an existing session is terminated by a new device login.', defaultSubject: 'Your izLearn session was terminated on another device', variables: [...COMMON, 'deviceInfo'] },

  // ---- Job Descriptions ----
  { type: 'jdPendingApproval', module: 'jobDescription', moduleLabel: 'Job Descriptions', label: 'JD Pending Approval', description: 'Sent to approvers when a Job Description is submitted for review.', defaultSubject: 'Job description pending approval: {{title}}', variables: [...COMMON, 'title'] },
  { type: 'jdDecision', module: 'jobDescription', moduleLabel: 'Job Descriptions', label: 'JD Decision / Assignment', description: 'Sent to a user when their JD is approved, assigned, deactivated, etc.', defaultSubject: 'Job description {{decision}}: {{title}}', variables: [...COMMON, 'title', 'decision'] },

  // ---- Announcements ----
  { type: 'announcement', module: 'announcements', moduleLabel: 'Announcements', label: 'Announcement', description: 'Sent to targeted users when an announcement is published.', defaultSubject: 'Announcement: {{title}}', variables: [...COMMON, 'title'] },
];

export const NOTIFICATION_BY_TYPE: Record<string, NotificationDef> = Object.fromEntries(
  NOTIFICATION_CATALOG.map((n) => [n.type, n]),
);
