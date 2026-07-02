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
 */

export interface PermAction {
  /** Stored permission key (e.g. "view", "approve", "reset_password"). */
  key: string;
  /** Business-friendly display name. */
  label: string;
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

// Common action builders (friendly labels are overridden per module where useful).
const A = (key: string, label: string): PermAction => ({ key, label });

export const PERMISSION_CATALOG: PermModuleDef[] = [
  // ----- Dashboard -----
  {
    module: 'dashboard',
    label: 'Dashboard',
    category: 'dashboard',
    actions: [A('view', 'View Dashboard'), A('configure_widgets', 'Configure Widgets')],
  },

  // ----- User & Access -----
  {
    module: 'userManagement',
    label: 'Users',
    category: 'userAccess',
    actions: [
      A('view', 'View Users'),
      A('create', 'Create / New User Request'),
      A('edit', 'Edit User'),
      A('approve', 'Activate / Deactivate / Change Roles'),
      A('assign', 'Assign Reporting Manager / Functional Role'),
      A('reset_password', 'Reset Password'),
      A('bulk_upload', 'Bulk Upload Users'),
      A('print', 'Print Users'),
      A('export', 'Export Users'),
    ],
  },
  {
    module: 'team',
    label: 'Team (Reporting Manager)',
    category: 'userAccess',
    actions: [
      A('view', 'View Assigned Team'),
      A('approve', 'Approve / Verify Team Training'),
      A('print', 'Print Team Records'),
      A('export', 'Export Team Records'),
    ],
  },
  {
    module: 'roleManagement',
    label: 'Roles & Access Control',
    category: 'userAccess',
    actions: [
      A('view', 'View Roles'),
      A('create', 'Create Role'),
      A('edit', 'Edit Role & Permission Matrix'),
      A('archive', 'Activate / Deactivate Role'),
      A('print', 'Print Permission Matrix'),
      A('export', 'Export Permission Matrix'),
    ],
  },

  // ----- Master Setup -----
  {
    module: 'masterSetup',
    label: 'Master Setup & Functional Roles',
    category: 'masterSetup',
    actions: [
      A('view', 'View Master Data'),
      A('create', 'Create Master Entry'),
      A('edit', 'Edit Master Entry'),
      A('archive', 'Activate / Deactivate Entry'),
      A('print', 'Print Master Data'),
      A('export', 'Export Master Data'),
    ],
  },

  // ----- Training Management -----
  {
    module: 'courseManagement',
    label: 'Courses / Training Topics',
    category: 'training',
    actions: [
      A('view', 'View Courses'),
      A('create', 'Create Topic'),
      A('edit', 'Edit Topic'),
      A('revise', 'Revise (New Version)'),
      A('archive', 'Archive / Unpublish'),
      A('approve', 'Publish (e-signed)'),
      A('assign', 'Assign Topic'),
      A('print', 'Print Course'),
      A('export', 'Export Course'),
    ],
  },
  {
    module: 'materialManagement',
    label: 'Material Library',
    category: 'training',
    actions: [
      A('view', 'View Materials'),
      A('create', 'Add / Upload Material'),
      A('edit', 'Edit / Replace Material'),
      A('archive', 'Archive Material'),
      A('print', 'Print Material List'),
      A('export', 'Export Material List'),
    ],
  },
  {
    module: 'topicVersionHistory',
    label: 'Version History',
    category: 'training',
    actions: [A('view', 'View Version History'), A('export', 'Export History')],
  },
  {
    module: 'questionBank',
    label: 'Question Bank',
    category: 'training',
    actions: [
      A('view', 'View Questions'),
      A('create', 'Create Question'),
      A('edit', 'Edit Question'),
      A('archive', 'Archive Question'),
    ],
  },
  // Hidden from the Roles & Access Control UI for now (commented out, not removed, so
  // they can be restored later). Existing stored permissions and route guards are
  // unaffected — this only controls what the permission editor renders.
  // {
  //   module: 'bundleManagement',
  //   label: 'Bundles',
  //   category: 'training',
  //   actions: [
  //     A('view', 'View Bundles'),
  //     A('create', 'Create Bundle'),
  //     A('edit', 'Edit Bundle'),
  //     A('archive', 'Archive Bundle'),
  //     A('assign', 'Assign Bundle'),
  //     A('print', 'Print'),
  //     A('export', 'Export'),
  //   ],
  // },
  // {
  //   module: 'trainingAssignment',
  //   label: 'Training Assignments',
  //   category: 'training',
  //   actions: [
  //     A('view', 'View Assignments'),
  //     A('create', 'Create Assignment'),
  //     A('edit', 'Edit / Assign Later'),
  //     A('assign', 'Assign Training'),
  //     A('approve', 'Approve Assignment'),
  //     A('print', 'Print Assignments'),
  //     A('export', 'Export Assignments'),
  //   ],
  // },
  {
    module: 'scheduling',
    label: 'Scheduling',
    category: 'training',
    actions: [
      A('view', 'View Schedules'),
      A('create', 'Create Schedule'),
      A('edit', 'Edit Schedule'),
      A('assign', 'Assign Trainees'),
      A('print', 'Print'),
      A('export', 'Export'),
    ],
  },
  {
    module: 'attendance',
    label: 'Attendance',
    category: 'training',
    actions: [A('view', 'View Attendance'), A('create', 'Mark Attendance'), A('edit', 'Edit Attendance'), A('export', 'Export')],
  },

  // ----- TNI / JD / CV -----
  {
    module: 'tni',
    label: 'Training Needs (TNI)',
    category: 'tniJdCv',
    actions: [
      A('view', 'View TNI'),
      A('create', 'Create TNI'),
      A('edit', 'Edit TNI Matrix'),
      A('assign', 'Assign Training from TNI'),
      A('approve', 'Approve TNI'),
      A('print', 'Print TNI'),
      A('export', 'Export TNI'),
    ],
  },
  {
    module: 'jobDescription',
    label: 'Job Descriptions',
    category: 'tniJdCv',
    actions: [
      A('view', 'View JDs / Templates'),
      A('create', 'Create JD Template'),
      A('edit', 'Edit JD Template'),
      A('approve', 'Approve JD'),
      A('assign', 'Assign JD / Functional Role'),
      A('acknowledge', 'Acknowledge Own JD'),
      A('print', 'Print JD'),
      A('export', 'Export JD'),
    ],
  },
  {
    module: 'cv',
    label: 'Curriculum Vitae',
    category: 'tniJdCv',
    actions: [
      A('view', 'View Own CV'),
      A('edit', 'Create / Edit Own CV'),
      A('print', 'Print CV'),
      A('export', 'Export CV'),
    ],
  },

  // ----- Assessment & Certificates -----
  {
    module: 'assessments',
    label: 'Assessments',
    category: 'assessmentCert',
    actions: [
      A('view', 'View Assessments'),
      A('take', 'Take Assessment (Start / Submit)'),
      A('create', 'Create Assessment'),
      A('edit', 'Edit Assessment'),
      A('archive', 'Archive Assessment'),
      A('approve', 'Review / Unblock'),
      A('print', 'Print'),
      A('export', 'Export'),
    ],
  },
  {
    module: 'certificates',
    label: 'Certificates & Templates',
    category: 'assessmentCert',
    actions: [
      A('view', 'View Certificates'),
      A('create', 'Generate Certificate'),
      A('edit', 'Manage Certificate Templates'),
      A('print', 'Print Certificate'),
      A('export', 'Export Certificate'),
    ],
  },

  // ----- Reports & Audit -----
  {
    module: 'reports',
    label: 'Reports',
    category: 'reportsAudit',
    actions: [A('view', 'View / Generate Reports'), A('print', 'Print Reports'), A('export', 'Export Reports')],
  },
  {
    module: 'auditTrail',
    label: 'Audit Trail',
    category: 'reportsAudit',
    actions: [A('view', 'View Audit Trail'), A('print', 'Print Audit Trail'), A('export', 'Export Audit Trail')],
  },
  {
    module: 'feedback',
    label: 'Feedback',
    category: 'reportsAudit',
    actions: [
      A('view', 'View Feedback'),
      A('create', 'Create Feedback Form'),
      A('edit', 'Edit / Respond'),
      A('archive', 'Archive Feedback'),
      A('print', 'Print'),
      A('export', 'Export'),
    ],
  },
  {
    module: 'announcements',
    label: 'Announcements',
    category: 'reportsAudit',
    actions: [
      A('view', 'View Announcements'),
      A('create', 'Create Announcement'),
      A('edit', 'Edit Announcement'),
      A('archive', 'Archive Announcement'),
      A('print', 'Print'),
      A('export', 'Export'),
    ],
  },

  // ----- System Configuration -----
  {
    module: 'systemConfig',
    label: 'System Configuration',
    category: 'system',
    actions: [A('view', 'View Configuration'), A('edit', 'Edit Configuration')],
  },
  {
    module: 'backup',
    label: 'Backup & Restore',
    category: 'system',
    actions: [A('view', 'View Backups'), A('create', 'Trigger Backup'), A('approve', 'Restore (e-signed)')],
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
