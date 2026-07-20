/**
 * Permission catalog — the single source of truth for the Roles & Permissions UI.
 *
 * Each module lists ONLY the actions that actually exist for it (no uniform verb
 * grid), grouped into business categories. Action keys reuse the standard verbs
 * (view/create/edit/archive/revise/assign/review/approve/print/export) wherever a
 * backend route checks them, plus a few module-specific extras. On save, the
 * granular actions are persisted together with the derived legacy flags
 * (read/write/approve/print/export — see deriveLegacyFlags), so every existing
 * backend route guard continues to enforce access.
 *
 * Every action carries a plain-language `description` — surfaced as an ⓘ tooltip in
 * Roles & Access Control — so anyone configuring a role understands exactly what the
 * permission grants.
 */

export interface PermAction {
  /** Stored permission key (e.g. "view", "approve", "reset_password"). */
  key: string;
  /** Business-friendly display name. */
  label: string;
  /** Plain-language explanation of what granting this permission allows. */
  description: string;
}

export interface PermModuleDef {
  /** Module/permission key (matches the stored permissions object + route guards). */
  module: string;
  /** Friendly module name. */
  label: string;
  /** Business category this module belongs to. */
  category: string;
  actions: PermAction[];
}

/** Ordered categories for the grouped, collapsible UI. */
export const PERMISSION_CATEGORIES: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'userAccess', label: 'User & Access' },
  { key: 'training', label: 'Training Management' },
  { key: 'tniJdCv', label: 'TNI / JD / CV' },
  { key: 'assessmentCert', label: 'Assessment & Certificates' },
  { key: 'reportsAudit', label: 'Reports & Audit' },
  { key: 'masterSetup', label: 'Master Setup' },
  { key: 'system', label: 'System Configuration' },
];

// Action builder: key, friendly label, and a plain-language description (ⓘ tooltip).
const A = (key: string, label: string, description: string): PermAction => ({ key, label, description });

export const PERMISSION_CATALOG: PermModuleDef[] = [
  // ----- Dashboard -----
  {
    module: 'dashboard',
    label: 'Dashboard',
    category: 'dashboard',
    actions: [
      A('view', 'View Dashboard', 'Open the dashboard home page with its personal (and, if permitted, team) summary.'),
      A(
        'view_org',
        'View Organisation Overview',
        'Show the ORGANISATION-WIDE dashboard section (totals across all users, courses, requests, TNI, JDs, etc.). Turn this OFF for a supervisor/manager so their dashboard shows only their own team’s numbers, not the whole organisation.',
      ),
    ],
  },

  // ----- User & Access -----
  {
    module: 'userManagement',
    label: 'Users',
    category: 'userAccess',
    actions: [
      A('view', 'View Users', "Open the Users list and view any user's profile details (all users, org-wide)."),
      A('create', 'Create / New User Request', 'Raise a new-user request, which goes to the User Requests queue for approval.'),
      A('edit', 'Edit User', "Edit any user's details (name, email, department, manager, functional role) org-wide."),
      A('approve', 'Activate / Deactivate / Change Roles', 'Activate or deactivate a user and change their assigned roles (e-signed).'),
      A('assign', 'Assign Reporting Manager / Functional Role', "Set a user's reporting manager and functional role."),
      A('reset_password', 'Reset Password', "Reset a user's login and signature password to a temporary one."),
      A('bulk_upload', 'Bulk Upload Users', 'Import many users at once from an Excel file.'),
      A('print', 'Print Users', 'Print the users list.'),
      A('export', 'Export Users', 'Download the users list as CSV or Excel.'),
    ],
  },
  {
    module: 'userRequests',
    label: 'User Requests',
    category: 'userAccess',
    actions: [
      A('view', 'View User Requests', 'Open the queue of pending new-user requests.'),
      A('approve', 'Approve / Reject User Request', 'Approve or reject a pending new-user request (e-signed). You cannot grant roles beyond your own.'),
    ],
  },
  {
    module: 'team',
    label: 'Team (Reporting Manager)',
    category: 'userAccess',
    actions: [
      A('view', 'View Assigned Team', 'See your assigned team / direct reports in My Team.'),
      A('create', 'Add Team Member', 'Add a new team member (raises a user request for your team).'),
      A('edit', 'Edit Team Member', 'Edit a team member — limited to your DIRECT reports (unless you also manage users org-wide).'),
      A('deactivate', 'Deactivate Team Member', 'Deactivate a team member — limited to your DIRECT reports (unless you also manage users org-wide).'),
      A('approve', 'Approve / Verify Team Training', "Approve or verify your team's training records."),
      A('print', 'Print Team Records', 'Print team training records.'),
      A('export', 'Export Team Records', 'Download team records as CSV or Excel.'),
    ],
  },
  {
    module: 'roleManagement',
    label: 'Roles & Access Control',
    category: 'userAccess',
    actions: [
      A('view', 'View Roles', 'Open Roles & Access Control and view roles and their permission matrices.'),
      A('create', 'Create Role', 'Create a new role.'),
      A('edit', 'Edit Role & Permission Matrix', 'Edit a role and toggle its permissions (e-signed).'),
      A('archive', 'Activate / Deactivate Role', 'Activate or deactivate a role.'),
      A('print', 'Print Permission Matrix', 'Print the permission matrix.'),
      A('export', 'Export Permission Matrix', 'Download the permission matrix.'),
    ],
  },

  // ----- Master Setup -----
  {
    module: 'masterSetup',
    label: 'Master Setup & Functional Roles',
    category: 'masterSetup',
    actions: [
      A('view', 'View Master Data', 'View master data — training types, document types, and functional roles/designations.'),
      A('create', 'Create Master Entry', 'Add a new master-data entry.'),
      A('edit', 'Edit Master Entry', 'Edit an existing master-data entry.'),
      A('archive', 'Activate / Deactivate Entry', 'Activate or deactivate a master-data entry.'),
      A('print', 'Print Master Data', 'Print master data.'),
      A('export', 'Export Master Data', 'Download master data.'),
    ],
  },

  // ----- Training Management -----
  {
    module: 'courseManagement',
    label: 'Courses / Training Topics',
    category: 'training',
    actions: [
      A('view', 'View Courses', 'Browse training topics / courses.'),
      A('create', 'Create Topic', 'Create a new training topic.'),
      A('edit', 'Edit Topic', 'Edit a topic. On a published topic, edits are staged until the e-signed publish.'),
      A('revise', 'Revise (New Version)', 'Create a new version of a published topic (triggers re-training).'),
      A('archive', 'Archive / Unpublish', 'Archive or unpublish a topic.'),
      A('approve', 'Publish (e-signed)', 'Publish a topic or its staged changes — requires an electronic signature.'),
      A('assign', 'Assign Topic', 'Assign a topic to users for training.'),
      A('print', 'Print Course', 'Print a course.'),
      A('export', 'Export Course', 'Export courses.'),
    ],
  },
  {
    module: 'materialManagement',
    label: 'Material Library',
    category: 'training',
    actions: [
      A('view', 'View Materials', 'View training materials in the library and within courses.'),
      A('create', 'Add / Upload Material', 'Upload or add new training material.'),
      A('edit', 'Edit / Replace Material', 'Replace or edit existing material (creates a new material version).'),
      A('archive', 'Archive Material', 'Archive a material file.'),
      A('print', 'Print Material List', 'Print the material list.'),
      A('export', 'Export Material List', 'Export the material list.'),
    ],
  },
  {
    module: 'topicVersionHistory',
    label: 'Version History',
    category: 'training',
    actions: [
      A('view', 'View Version History', "View a course's version history."),
      A('export', 'Export History', 'Export version history.'),
    ],
  },
  {
    module: 'questionBank',
    label: 'Question Bank',
    category: 'training',
    actions: [
      A('view', 'View Questions', "View a topic's assessment questions."),
      A('create', 'Create Question', 'Add a new question to a topic.'),
      A('edit', 'Edit Question', 'Edit an existing question.'),
      A('archive', 'Archive Question', 'Archive a question.'),
    ],
  },
  // Hidden from the Roles & Access Control UI for now (commented out, not removed, so
  // they can be restored later). Existing stored permissions and route guards are
  // unaffected — this only controls what the permission editor renders.
  // {
  //   module: 'bundleManagement',
  //   label: 'Bundles',
  //   category: 'training',
  //   actions: [ ... ],
  // },
  // {
  //   module: 'trainingAssignment',
  //   label: 'Training Assignments',
  //   category: 'training',
  //   actions: [ ... ],
  // },
  {
    module: 'scheduling',
    label: 'Scheduling',
    category: 'training',
    actions: [
      A('view', 'View Schedules', 'View training schedules.'),
      A('create', 'Create Schedule', 'Create a training schedule (classroom, OJT, or offline).'),
      A('edit', 'Edit Schedule', 'Edit an existing schedule.'),
      A('assign', 'Assign Trainees', 'Assign trainees to a schedule.'),
      A('print', 'Print', 'Print schedules.'),
      A('export', 'Export', 'Export schedules.'),
    ],
  },
  {
    module: 'attendance',
    label: 'Attendance',
    category: 'training',
    actions: [
      A('view', 'View Attendance', 'View attendance for a schedule.'),
      A('create', 'Mark Attendance', 'Mark attendance manually or by Excel import.'),
      A('edit', 'Edit Attendance', 'Correct or re-mark existing attendance — requires a reason for change.'),
      A('export', 'Export', 'Export attendance.'),
    ],
  },

  // ----- TNI / JD / CV -----
  {
    module: 'tni',
    label: 'Training Needs (TNI)',
    category: 'tniJdCv',
    actions: [
      A('view', 'View TNI', 'View Training Needs Identification records and the requirement matrix.'),
      A('create', 'Create TNI', 'Create a TNI record.'),
      A('edit', 'Edit TNI Matrix', 'Edit the TNI requirement matrix.'),
      A('assign', 'Assign Training from TNI', 'Assign training identified by TNI.'),
      A('approve', 'Approve TNI', 'Approve a TNI (e-signed).'),
      A('print', 'Print TNI', 'Print TNI.'),
      A('export', 'Export TNI', 'Export TNI.'),
    ],
  },
  {
    module: 'jobDescription',
    label: 'Job Descriptions',
    category: 'tniJdCv',
    actions: [
      A('view', 'View JDs / Templates', "View job descriptions and JD templates (your reports' JDs unless you manage users org-wide)."),
      A('create', 'Create JD Template', 'Create a JD template.'),
      A('edit', 'Edit JD Template', 'Edit a JD template — republishes a new version to every assigned employee to re-acknowledge.'),
      A('approve', 'Approve JD', 'Approve a job description.'),
      A('assign', 'Assign JD / Functional Role', 'Assign a JD or functional role to a user (your direct reports unless you manage users org-wide).'),
      A('acknowledge', 'Acknowledge Own JD', 'Acknowledge your own assigned job description.'),
      A('print', 'Print JD', 'Print a JD.'),
      A('export', 'Export JD', 'Export a JD.'),
    ],
  },
  {
    module: 'cv',
    label: 'Curriculum Vitae',
    category: 'tniJdCv',
    actions: [
      A('view', 'View Own CV', 'View your own CV.'),
      A('edit', 'Create / Edit Own CV', 'Create or edit your own CV.'),
      A('print', 'Print CV', 'Print your CV.'),
      A('export', 'Export CV', 'Export your CV.'),
    ],
  },

  // ----- Assessment & Certificates -----
  {
    module: 'assessments',
    label: 'Assessments',
    category: 'assessmentCert',
    actions: [
      A('view', 'View Assessments', 'View your own assessments and results.'),
      A('view_others', "View Others' Assessments", "View other users' assessment attempts — your team's (supervisor) or everyone's (org-wide user managers)."),
      A('take', 'Take Assessment (Start / Submit)', 'Start and submit assessments assigned to you.'),
      A('create', 'Create Assessment', 'Create assessments and questions.'),
      A('edit', 'Edit Assessment', 'Edit assessments.'),
      A('archive', 'Archive Assessment', 'Archive an assessment.'),
      A('approve', 'Review / Unblock', 'Review attempts and unblock a trainee who is locked out after max attempts.'),
      A('print', 'Print', 'Print assessments.'),
      A('export', 'Export', 'Export assessments.'),
    ],
  },
  {
    module: 'certificates',
    label: 'Certificates',
    category: 'assessmentCert',
    actions: [
      A('view', 'View Certificates', 'View your own certificates.'),
      A('view_others', "View Others' Certificates", "View other users' certificates — your team's (supervisor) or everyone's (org-wide user managers)."),
      A('create', 'Generate Certificate', 'Generate a certificate.'),
      A('print', 'Print Certificate', 'Print a certificate.'),
      A('export', 'Export Certificate', 'Export certificates.'),
    ],
  },
  {
    module: 'certificateTemplates',
    label: 'Certificate Templates',
    category: 'assessmentCert',
    actions: [
      A('view', 'View Templates', 'View certificate templates.'),
      A('create', 'Create Template', 'Create a certificate template.'),
      A('edit', 'Edit Template', 'Edit a certificate template.'),
    ],
  },

  // ----- Reports & Audit -----
  {
    module: 'reports',
    label: 'Reports',
    category: 'reportsAudit',
    actions: [
      A('view', 'View / Generate Reports', 'Generate and view reports.'),
      A('print', 'Print Reports', 'Print reports.'),
      A('export', 'Export Reports', 'Export reports as CSV, Excel, or PDF.'),
    ],
  },
  {
    module: 'auditTrail',
    label: 'Audit Trail',
    category: 'reportsAudit',
    actions: [
      A('view', 'View Audit Trail', 'View the system audit trail.'),
      A('print', 'Print Audit Trail', 'Print the audit trail.'),
      A('export', 'Export Audit Trail', 'Export the audit trail as CSV, Excel, or PDF.'),
    ],
  },
  {
    module: 'feedback',
    label: 'Feedback',
    category: 'reportsAudit',
    actions: [
      A('view', 'View Feedback', 'View feedback forms and their analysis.'),
      A('create', 'Create Feedback Form', 'Create a feedback form. (Submitting a response needs no permission — any user can.)'),
      A('edit', 'Edit Feedback Form', 'Edit an existing feedback form.'),
      A('archive', 'Archive Feedback', 'Archive/deactivate a feedback form.'),
      A('print', 'Print', 'Print feedback.'),
      A('export', 'Export', 'Export feedback.'),
    ],
  },
  {
    module: 'announcements',
    label: 'Announcements',
    category: 'reportsAudit',
    actions: [
      A('view', 'View Announcements', 'View announcements in the management list. (Every user sees their own targeted feed regardless.)'),
      A('create', 'Create Announcement', 'Create an announcement targeted at chosen roles.'),
      A('edit', 'Edit Announcement', 'Edit an existing announcement.'),
      A('archive', 'Archive Announcement', 'Archive/deactivate an announcement.'),
      A('print', 'Print', 'Print announcements.'),
      A('export', 'Export', 'Export announcements.'),
    ],
  },

  // ----- System Configuration -----
  {
    module: 'systemConfig',
    label: 'System Configuration',
    category: 'system',
    actions: [
      A('view', 'View Configuration', 'View system configuration.'),
      A('edit', 'Edit Configuration', 'Edit system configuration — policies, notifications, and security settings.'),
    ],
  },
  {
    module: 'backup',
    label: 'Backup & Restore',
    category: 'system',
    actions: [
      A('view', 'View Backups', 'View the list of backups.'),
      A('create', 'Trigger Backup', 'Trigger a new backup.'),
      A('approve', 'Restore (e-signed)', 'Restore the system from a backup — requires an electronic signature.'),
    ],
  },
];

/** Map of module key → its definition. */
export const CATALOG_BY_MODULE: Record<string, PermModuleDef> = Object.fromEntries(
  PERMISSION_CATALOG.map((m) => [m.module, m]),
);

/** The real action keys for a module (empty if the module isn't in the catalog). */
export function actionsForModule(module: string): string[] {
  return CATALOG_BY_MODULE[module]?.actions.map((a) => a.key) ?? [];
}
