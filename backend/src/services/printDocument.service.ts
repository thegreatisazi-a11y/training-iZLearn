/**
 * Registry of every printable document in the app.
 *
 * One entry per document type. Each entry declares the permission needed to print it and a
 * `build` function that re-reads the data from the database - through the SAME scoped service
 * function the on-screen view uses - and returns the document body.
 *
 * Why a registry rather than an endpoint per page: there are 16 print buttons across the app
 * and they were all producing their own header, footer and layout in the browser. A single
 * table keeps the furniture, the audit event and the permission check in one place, so a new
 * printable document is one entry rather than a new controller.
 *
 * IMPORTANT: a builder must never accept content from the caller. It receives identifiers and
 * filters only, and reads everything it prints. That is the whole point - see the note at the
 * top of utils/printDocument.ts.
 */
import { PERMISSION_CATALOG, PERMISSION_CATEGORIES, type PermissionMatrix } from '@izlearn/shared';
import type { AuthUser } from '../types';
import { AppError } from '../utils/response';
import { printTable, escapeHtml } from '../utils/printDocument';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { hasOrgWideScope } from '../utils/accessScope';
import * as userSvc from './user.service';
import * as topicSvc from './trainingTopic.service';
import * as bundleSvc from './bundle.service';
import * as roleSvc from './role.service';
import * as tniSvc from './tni.service';
import * as jdSvc from './jobDescription.service';
import * as cvSvc from './cv.service';
import * as assessmentSvc from './assessment.service';

export interface BuildContext {
  /** The authenticated caller. Scoping is derived from this, never from the query string. */
  requester: AuthUser;
  /** Raw query string values. Builders read only identifiers and filters from this. */
  params: Record<string, string | undefined>;
}

export interface BuiltDocument {
  title: string;
  bodyHtml: string;
  /** For the AuditTrail PRINT event. */
  entityType: string;
  entityId: string;
  landscape?: boolean;
}

interface DocumentDef {
  /** Permission required to print, as [module, action]. */
  permission: [string, string];
  build(ctx: BuildContext): Promise<BuiltDocument>;
}

/* ------------------------------------------------------------------ helpers */

/**
 * "All rows" for a list document.
 *
 * A printed list must be the complete filtered set, not the page the operator happened to be
 * looking at. The old client-side prints emitted whatever was in the table - so printing
 * "Users" from page 2 produced a document titled "Users" holding 20 of 300 rows, with nothing
 * on the page admitting it. pageSize is passed straight to the service (not through the
 * paginationQuery schema, which caps at 1000) exactly as the CSV exporters already do.
 */
const ALL_ROWS = { page: 1, pageSize: 100000, sortDir: 'asc' as const, includeInactive: false };

/** Sub-heading under the document title: row count plus whatever filters were applied. */
function listSubtitle(count: number, noun: string, filters: Array<string | null | undefined>): string {
  const applied = filters.filter(Boolean).join(' · ');
  const plural = count === 1 ? noun : `${noun}s`;
  return `<div class="sub">${count} ${escapeHtml(plural)}${applied ? ` · ${escapeHtml(applied)}` : ''}</div>`;
}

function heading(title: string, sub?: string): string {
  return `<h1>${escapeHtml(title)}</h1>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}`;
}

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Seconds as "1h 05m 09s" / "5m 09s" / "9s", matching the on-screen assessment result. */
function formatDuration(total: number | null | undefined): string {
  const s = Math.max(0, Math.round(total ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/* --------------------------------------------------------------- registry */

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  PERMISSION_CATEGORIES.map((c) => [c.key, c.label]),
);

export const PRINT_DOCUMENTS: Record<string, DocumentDef> = {
  /* ---------------------------------------------------------------- users */
  users: {
    permission: ['userManagement', 'print'],
    async build({ requester, params }) {
      // Same department/location scoping the users list and its CSV export apply, so a
      // printed list can never contain a row the caller cannot see on screen.
      const orgWide = hasOrgWideScope(requester.permissions, 'userManagement');
      const scope = orgWide
        ? {}
        : { departmentId: requester.departmentId ?? undefined, excludeUserId: requester.id };
      const includeInactive = params.status === 'all' || params.status === 'inactive';
      const rows = await userSvc.listUsersForExport(
        { ...ALL_ROWS, sortBy: 'fullName', search: params.search || undefined, includeInactive },
        scope,
      );
      const shown = params.status === 'inactive' ? rows.filter((u) => !u.isActive) : rows;
      const statusLabel = params.status === 'all' ? 'All' : params.status === 'inactive' ? 'Inactive' : 'Active';
      return {
        title: 'Users',
        entityType: 'User',
        entityId: 'list',
        landscape: true,
        bodyHtml:
          `<h1>Users</h1>` +
          listSubtitle(shown.length, 'record', [
            params.search ? `search: "${params.search}"` : null,
            statusLabel,
          ]) +
          printTable(
            ['Employee ID', 'Full Name', 'Username', 'Email', 'Department', 'Location', 'Roles', 'Status'],
            shown.map((r) => [
              r.employeeId,
              r.fullName,
              r.windowsUsername,
              r.email ?? '',
              r.departmentName ?? '',
              r.locationName ?? '',
              (r.roleNames ?? []).join(', '),
              r.isActive ? 'Active' : 'Inactive',
            ]),
          ),
      };
    },
  },

  /* -------------------------------------------------------------- my team */
  'my-team': {
    permission: ['team', 'print'],
    async build({ requester, params }) {
      // team:view_all is the explicit org-wide toggle; everyone else gets direct reports only.
      const seeAll = hasOrgWideScope(requester.permissions, 'team');
      const r = await userSvc.listMyTeam(requester.id, seeAll, {
        ...ALL_ROWS,
        search: params.search || undefined,
      });
      const rows = r.data;
      return {
        title: 'My Team',
        entityType: 'User',
        entityId: 'team',
        landscape: true,
        bodyHtml:
          `<h1>My Team</h1>` +
          listSubtitle(rows.length, 'team member', [params.search ? `search: "${params.search}"` : null]) +
          printTable(
            ['Name', 'Employee ID', 'Functional Role(s)', 'Training (done/total)', 'Assessments passed', 'JD Ack', 'CV', 'Certificates', 'TNI pending'],
            rows.map((r) => [
              r.fullName,
              r.employeeId,
              (r.functionalRoleNames ?? []).join(', '),
              `${r.training.completed}/${r.training.total}`,
              r.assessmentsPassed ?? 0,
              r.jdAcknowledged ? 'Yes' : 'Pending',
              r.cvCompleted ? 'Yes' : 'No',
              r.certificates,
              r.tniPending,
            ]),
          ),
      };
    },
  },

  /* ------------------------------------------------------------------ tni */
  tni: {
    permission: ['tni', 'print'],
    async build({ params }) {
      const r = await tniSvc.listTNI({ ...ALL_ROWS, status: params.status || undefined });
      const rows = r.data as Array<{
        userFullName?: string | null;
        topicTitle?: string | null;
        justification?: string | null;
        status: string;
      }>;
      return {
        title: 'Training Needs Identification',
        entityType: 'TNI',
        entityId: 'list',
        bodyHtml:
          `<h1>Training Needs Identification</h1>` +
          listSubtitle(rows.length, 'record', [params.status ? `status: ${params.status}` : null]) +
          printTable(
            ['User', 'Course', 'Justification', 'Status'],
            rows.map((r) => [r.userFullName, r.topicTitle, r.justification, r.status]),
          ),
      };
    },
  },

  /* -------------------------------------------------------------- courses */
  courses: {
    permission: ['courseManagement', 'print'],
    async build({ params }) {
      const r = await topicSvc.listTopics({ ...ALL_ROWS, sortBy: 'createdAt', search: params.search || undefined, status: params.status || undefined });
      const rows = r.data as Array<{
        topicNumber: string | null;
        topicCode: string;
        title: string;
        trainingType: string;
        trainingTypes?: string[] | null;
        durationMinutes: number;
        passingScorePercent: number;
        currentVersion: number;
        status: string;
        requiresAssessment?: boolean | null;
      }>;
      const types = (t: (typeof rows)[number]) =>
        (t.trainingTypes?.length ? t.trainingTypes : [t.trainingType]).filter(Boolean).join(', ');
      return {
        title: 'Training Courses',
        entityType: 'TrainingTopic',
        entityId: 'list',
        landscape: true,
        bodyHtml:
          `<h1>Training Courses</h1>` +
          listSubtitle(rows.length, 'course', [
            params.search ? `search: "${params.search}"` : null,
            params.status ? `status: ${params.status}` : null,
          ]) +
          printTable(
            ['SOP No.', 'Title', 'Type', 'Duration', 'Pass %', 'Version', 'Status'],
            rows.map((r) => [
              r.topicNumber || r.topicCode,
              r.title,
              types(r),
              r.durationMinutes,
              r.requiresAssessment === false ? '—' : `${r.passingScorePercent}%`,
              `v${r.currentVersion}`,
              r.status,
            ]),
          ),
      };
    },
  },

  course: {
    permission: ['courseManagement', 'print'],
    async build({ params }) {
      if (!params.id) throw AppError.badRequest('A course id is required.');
      const t = (await topicSvc.getTopic(params.id)) as unknown as {
        id: string;
        title: string;
        topicNumber: string | null;
        topicCode: string;
        trainingType: string;
        trainingTypes?: string[] | null;
        durationMinutes: number;
        passingScorePercent: number;
        maxAttempts: number;
        currentVersion: number;
        status: string;
        requiresAssessment?: boolean | null;
      };
      const typeLabel = (t.trainingTypes?.length ? t.trainingTypes : [t.trainingType]).filter(Boolean).join(', ');
      return {
        title: `Course — ${t.title}`,
        entityType: 'TrainingTopic',
        entityId: t.id,
        bodyHtml:
          heading(t.title, `${t.topicNumber || t.topicCode} · v${t.currentVersion} · ${t.status}`) +
          printTable(
            ['Field', 'Value'],
            [
              ['Type', typeLabel],
              ['Duration (min)', t.durationMinutes],
              // Placeholders are unused on a reading-only course, same as the table view.
              ['Pass %', t.requiresAssessment === false ? '—' : `${t.passingScorePercent}%`],
              ['Max Attempts', t.requiresAssessment === false ? '—' : t.maxAttempts],
              ['Version', `v${t.currentVersion}`],
              ['Status', t.status],
            ],
          ),
      };
    },
  },

  /* ---------------------------------------------------------------- roles */
  roles: {
    permission: ['roleManagement', 'print'],
    async build({ params }) {
      const includeInactive = params.status === 'all' || params.status === 'inactive';
      const r = await roleSvc.listRoles({ ...ALL_ROWS, sortBy: 'roleName', search: params.search || undefined, includeInactive });
      const all = r.data as Array<{ roleName: string; description: string | null; isActive: boolean }>;
      const rows = params.status === 'inactive' ? all.filter((x) => !x.isActive) : all;
      return {
        title: 'Roles & Access Control',
        entityType: 'Role',
        entityId: 'list',
        bodyHtml:
          `<h1>Roles &amp; Access Control</h1>` +
          listSubtitle(rows.length, 'role', [`filter: ${params.status || 'active'}`]) +
          printTable(
            ['Role', 'Description', 'Status'],
            rows.map((x) => [x.roleName, x.description ?? '', x.isActive ? 'Active' : 'Inactive']),
          ),
      };
    },
  },

  'role-permissions': {
    permission: ['roleManagement', 'print'],
    async build({ params }) {
      if (!params.id) throw AppError.badRequest('A role id is required.');
      const role = await roleSvc.getRole(params.id);
      const matrix = (role.permissions ?? {}) as PermissionMatrix;
      // Every catalog action, granted or not - same as the Excel export. A matrix that listed
      // only granted actions cannot be reviewed, because "absent" and "denied" look identical.
      const rows: string[][] = [];
      for (const def of PERMISSION_CATALOG) {
        for (const a of def.actions) {
          rows.push([
            CATEGORY_LABEL[def.category] ?? def.category,
            def.label,
            def.module,
            a.label,
            a.key,
            matrix[def.module]?.[a.key] ? 'Yes' : 'No',
          ]);
        }
      }
      return {
        title: `Role Permissions — ${role.roleName}`,
        entityType: 'Role',
        entityId: role.id,
        bodyHtml:
          `<h1>Role Permissions — ${escapeHtml(role.roleName)}</h1>` +
          `<div class="sub">Status: ${role.isActive ? 'Active' : 'Inactive'}${role.description ? ` · ${escapeHtml(role.description)}` : ''}</div>` +
          printTable(['Category', 'Module', 'Module Key', 'Action', 'Action Key', 'Granted'], rows),
      };
    },
  },

  /* -------------------------------------------------------------- bundles */
  // Bundles is superseded by TNI and hidden in the UI, but still printable while it exists.
  bundles: {
    permission: ['bundleManagement', 'view'],
    async build({ params }) {
      const includeInactive = params.status === 'all' || params.status === 'inactive';
      const r = await bundleSvc.listBundles({ ...ALL_ROWS, sortBy: 'createdAt', search: params.search || undefined, includeInactive });
      const rows = r.data as Array<{
        name: string;
        topicIds?: string[] | null;
        departmentIds?: string[] | null;
        designationIds?: string[] | null;
        userIds?: string[] | null;
        isActive: boolean;
      }>;
      return {
        title: 'Bundles',
        entityType: 'TopicBundle',
        entityId: 'list',
        bodyHtml:
          `<h1>Bundles</h1>` +
          listSubtitle(rows.length, 'bundle', [params.search ? `search: "${params.search}"` : null]) +
          printTable(
            ['Name', 'Courses', 'Targets', 'Status'],
            rows.map((b) => [
              b.name,
              b.topicIds?.length ?? 0,
              `${b.departmentIds?.length ?? 0} dept · ${b.designationIds?.length ?? 0} desig · ${b.userIds?.length ?? 0} user`,
              b.isActive ? 'Active' : 'Inactive',
            ]),
          ),
      };
    },
  },

  bundle: {
    permission: ['bundleManagement', 'view'],
    async build({ params }) {
      if (!params.id) throw AppError.badRequest('A bundle id is required.');
      const b = await bundleSvc.getBundleDetail(params.id);
      return {
        title: `Bundle — ${b.name}`,
        entityType: 'TopicBundle',
        entityId: b.id,
        bodyHtml:
          heading(b.name, `${b.description ?? 'Training bundle'} · ${b.isActive ? 'Active' : 'Inactive'}`) +
          `<div class="section">Courses (${b.topics.length})</div>` +
          printTable(
            ['Course No.', 'Course', 'Type', 'Version', 'Status'],
            b.topics.map((t) => [t.topicNumber || t.topicCode, t.title, t.trainingType, `v${t.currentVersion}`, t.status]),
          ) +
          `<div class="section">Targets</div>` +
          printTable(
            ['Departments', 'Functional Roles', 'Roles', 'Resolved users'],
            [[
              b.departments.map((d) => d.name).join(', '),
              b.designations.map((d) => d.displayName).join(', '),
              b.roles.map((r) => r.roleName).join(', '),
              b.resolvedUserCount,
            ]],
          ),
      };
    },
  },

  /* ----------------------------------------------------- job description */
  'job-description': {
    permission: ['jobDescription', 'print'],
    async build({ requester, params }) {
      // `self` prints the caller's own live JD; otherwise the id is resolved through the
      // viewer-scoped read, so a JD the caller may not see cannot be printed.
      const jd = await jdSvc.getJDForPrint(
        { id: params.id, self: params.self === 'true' },
        { id: requester.id, permissions: requester.permissions as Record<string, Record<string, boolean>> },
      );

      return {
        title: `Job Description — ${jd.title}`,
        entityType: 'JobDescription',
        entityId: jd.id,
        bodyHtml:
          heading('Job Description', `${jd.title} · v${jd.version} · ${String(jd.status).replace(/_/g, ' ')}`) +
          printTable(
            ['Field', 'Value'],
            [
              ['Employee Name', dash(jd.employeeName)],
              ['Employee Code', dash(jd.employeeCode)],
              ['Department', dash(jd.departmentName)],
              ['Functional Role', dash(jd.functionalRoleName)],
              ['JD Version', `v${jd.version}`],
              ['Approved By', dash(jd.approvedByName)],
              ['Acknowledged', jd.acknowledgedAt ? `Yes · ${formatDate(jd.acknowledgedAt)}` : 'Pending'],
            ],
          ) +
          `<div class="section">Job Description Details</div>` +
          `<div>${sanitiseRichText(jd.content)}</div>`,
      };
    },
  },

  /* ------------------------------------------------------------------- cv */
  cv: {
    permission: ['cv', 'print'],
    async build({ requester, params }) {
      const targetUserId = params.userId || requester.id;
      // getUserCV enforces owner / supervisor / admin visibility.
      const { header, cv } = await cvSvc.getUserCV(targetUserId, requester);

      // A specific historical version is reconstructed from the audit snapshots, never sent
      // by the browser. Only the owner has a history endpoint, so this is self-service only.
      let snapshot: unknown = cv;
      let version = (cv as { version?: number } | null)?.version ?? 1;
      if (params.version && targetUserId === requester.id) {
        const wanted = Number(params.version);
        const { versions } = await cvSvc.getMyCvHistory(requester.id);
        const found = versions.find((v) => v.version === wanted);
        if (!found) throw AppError.notFound(`CV version v${wanted} was not found.`);
        snapshot = found.cv;
        version = wanted;
      }
      if (!snapshot) throw AppError.notFound('No CV has been saved yet.');

      return {
        title: 'Curriculum Vitae',
        entityType: 'CurriculumVitae',
        entityId: targetUserId,
        bodyHtml: cvBody(header, snapshot as CvSnapshot, version),
      };
    },
  },

  /* ---------------------------------------------------- assessment result */
  'assessment-result': {
    permission: ['assessments', 'print'],
    async build({ requester, params }) {
      if (!params.attemptId) throw AppError.badRequest('An attempt id is required.');
      // Same scope resolution the on-screen review endpoint uses, so an attempt the caller
      // may not read cannot be printed either. It also decides whether the answer key is
      // included: a learner reviewing their OWN attempt does not get it, because the
      // assessment can be re-attempted.
      const scope = await assessmentSvc.attemptViewerScope({
        id: requester.id,
        roleNames: requester.roleNames,
        permissions: requester.permissions as Record<string, Record<string, boolean>>,
      });
      const r = await assessmentSvc.reviewAttempt(params.attemptId, requester.id, scope);

      // A reading-only course is completed by acknowledgement, so there is no score, pass
      // mark or question breakdown - only a completion record.
      const isReadingCompletion = r.totalQuestions === 0;
      const docTitle = isReadingCompletion ? 'Training Completion Record' : 'Assessment Result';
      const courseLabel = `${r.topicNumber ? `${r.topicNumber} – ` : ''}${r.topicTitle ?? 'Assessment'}`;
      const completedOn = r.completedAt ? formatDateTime(r.completedAt) : '—';

      // Prominent pass/fail banner with the headline score (as shown on screen).
      const accent = r.isPassed ? '#15803d' : '#b91c1c';
      const accentBg = r.isPassed ? '#dcfce7' : '#fee2e2';
      const banner = isReadingCompletion
        ? ''
        : `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;` +
          `border:1px solid ${accent};background:${accentBg};border-radius:8px;padding:12px 16px;margin:14px 0;">` +
          `<div style="font-size:18px;font-weight:700;letter-spacing:.03em;color:${accent};">${r.isPassed ? 'PASSED' : 'FAILED'}</div>` +
          `<div style="text-align:right;color:#334155;">` +
          `<div style="font-size:22px;font-weight:700;line-height:1;">${r.score}%</div>` +
          `<div style="font-size:11px;color:#64748b;margin-top:2px;">Passing score ${r.passingScorePercent}%</div>` +
          `</div></div>`;

      // Key/value grid, three to a row. Result / score / pass mark are in the banner above
      // and deliberately not repeated here.
      const cell = (label: string, value: string) =>
        `<td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #eef2f7;width:33%;">` +
        `<div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:2px;">${escapeHtml(label)}</div>` +
        `<div style="font-size:13px;font-weight:600;color:#1e293b;">${value}</div></td>`;
      const blank = cell('', '');
      const gridRow = (...cells: string[]) => `<tr>${cells.join('')}</tr>`;

      const identityRow = gridRow(
        cell('Employee', escapeHtml(dash(r.employeeName))),
        cell('Employee ID', escapeHtml(dash(r.employeeId))),
        cell('Department', escapeHtml(dash(r.department))),
      );
      const details = isReadingCompletion
        ? `<table style="width:100%;border-collapse:collapse;margin:6px 0 4px;">` +
          identityRow +
          gridRow(
            cell('Completed On', escapeHtml(completedOn)),
            cell('Completion Method', 'Read &amp; acknowledged'),
            cell('Time on Reading', formatDuration(r.readingTimeSeconds)),
          ) +
          `</table>`
        : `<table style="width:100%;border-collapse:collapse;margin:6px 0 4px;">` +
          identityRow +
          gridRow(
            cell('Completed On', escapeHtml(completedOn)),
            cell('Attempt', `${r.attemptNumber} of ${r.maxAttempts}`),
            cell('Correct', String(r.correctCount)),
          ) +
          gridRow(
            cell('Incorrect', String(r.incorrectCount)),
            cell('Unattempted', String(r.unattempted)),
            cell('Time on Assessment', formatDuration(r.timeSpentSeconds)),
          ) +
          gridRow(cell('Time on Reading', formatDuration(r.readingTimeSeconds)), blank, blank) +
          `</table>`;

      const review = r.allDetails.length ? r.allDetails : r.incorrectDetails;
      const questions = review
        .map((d, i) => {
          const mark = d.isCorrect === true ? ' ✓' : d.isCorrect === false ? ' ✗' : '';
          return (
            `<div style="margin:10px 0;padding:8px 0;border-top:1px solid #ddd;">` +
            `<div><strong>${i + 1}. ${escapeHtml(d.questionText)}${mark}</strong></div>` +
            `<div>Your answer: ${escapeHtml(String(d.userAnswer ?? '') || '—')}</div>` +
            // Absent (not blank) when the answer key is withheld - reviewAttempt decides.
            (d.correctAnswer != null && d.correctAnswer !== ''
              ? `<div>Correct answer: ${escapeHtml(String(d.correctAnswer))}</div>`
              : '') +
            (d.explanation ? `<div>Explanation: ${escapeHtml(String(d.explanation))}</div>` : '') +
            `</div>`
          );
        })
        .join('');

      return {
        title: docTitle,
        entityType: 'AssessmentAttempt',
        entityId: r.attemptId,
        bodyHtml:
          heading(courseLabel, docTitle) +
          banner +
          details +
          (r.submissionReasonLabel ? `<p class="meta">Submission: ${escapeHtml(r.submissionReasonLabel)}</p>` : '') +
          (questions ? `<div class="section">Question Review</div>${questions}` : ''),
      };
    },
  },
};

/* ------------------------------------------------------------- cv rendering */

interface CvSnapshot {
  version?: number | null;
  languagesKnown?: string | null;
  languages?: Array<{ language?: string; read?: boolean; write?: boolean; understand?: boolean }> | null;
  qualifications?: Array<{ year?: string; degree?: string; specialization?: string; institute?: string }> | null;
  currentRole?: string | null;
  currentTenureFrom?: string | null;
  currentTenureTo?: string | null;
  currentResponsibilities?: string | null;
  experience?: Array<{ organisation?: string; role?: string; tenureFrom?: string; tenureTo?: string; responsibilities?: string }> | null;
  trainings?: Array<{ srNo?: string | number; detail?: string }> | null;
  publications?: Array<{ srNo?: string | number; detail?: string }> | null;
  experienceNotApplicable?: boolean | null;
  trainingsNotApplicable?: boolean | null;
  publicationsNotApplicable?: boolean | null;
}

interface CvHeader {
  employeeName: string;
  employeeCode: string;
  departmentName?: string | null;
  functionalRole?: string | null;
}

/**
 * CV body.
 *
 * There were TWO different client-side CV layouts before this - MyCVPage rendered the
 * "Not Applicable" markers, the current-role tenure range and the manual serial numbers,
 * while lib/cvPrint.ts (used by Team CVs and My Team) rendered none of them. So the same
 * CV printed differently depending on which screen you printed it from. This is the fuller
 * of the two, and now the only one.
 */
function cvBody(header: CvHeader, cv: CvSnapshot, version: number): string {
  const langs = (cv.languages ?? []).filter((l) => l.language);
  const languagesBlock = langs.length
    ? printTable(
        ['Language', 'Read', 'Write', 'Understand'],
        langs.map((l) => [l.language, l.read ? 'Yes' : 'No', l.write ? 'Yes' : 'No', l.understand ? 'Yes' : 'No']),
      )
    : `<p>${escapeHtml(cv.languagesKnown || '—')}</p>`;

  const tenure = `${escapeHtml(cv.currentTenureFrom || '?')} → ${escapeHtml(cv.currentTenureTo || 'present')}`;
  const notApplicable = '<p>Not Applicable</p>';

  return (
    `<h1>Curriculum Vitae</h1>` +
    `<div class="meta">${escapeHtml(header.employeeName)} (${escapeHtml(header.employeeCode)}) · ${escapeHtml(header.functionalRole ?? '')} · ${escapeHtml(header.departmentName ?? '')} · v${version}</div>` +
    `<div class="section">Languages Known</div>${languagesBlock}` +
    `<div class="section">Educational Qualifications</div>` +
    printTable(
      ['Year', 'Degree', 'Specialization', 'Institute'],
      (cv.qualifications ?? []).map((q) => [q.year, q.degree, q.specialization, q.institute]),
    ) +
    `<div class="section">Current Role</div>` +
    `<p>${escapeHtml(cv.currentRole || '—')} (${tenure})</p><p>${escapeHtml(cv.currentResponsibilities || '')}</p>` +
    `<div class="section">Previous Positions</div>` +
    (cv.experienceNotApplicable
      ? notApplicable
      : printTable(
          ['Organisation', 'Role', 'From', 'To', 'Responsibilities'],
          (cv.experience ?? []).map((e) => [e.organisation, e.role, e.tenureFrom, e.tenureTo, e.responsibilities]),
        )) +
    `<div class="section">Trainings / Seminars / Workshops</div>` +
    (cv.trainingsNotApplicable
      ? notApplicable
      : printTable(['#', 'Detail'], (cv.trainings ?? []).map((t, i) => [t.srNo ?? i + 1, t.detail]))) +
    `<div class="section">Publications / Memberships</div>` +
    (cv.publicationsNotApplicable
      ? notApplicable
      : printTable(['#', 'Detail'], (cv.publications ?? []).map((pub, i) => [pub.srNo ?? i + 1, pub.detail])))
  );
}

/**
 * JD content is rich text authored in the app's editor. The browser used DOMPurify; server-side
 * the safe set is narrower still - only inline emphasis, lists, paragraphs and line breaks are
 * kept and every attribute is dropped, so nothing in stored content can pull a remote resource
 * or run script inside the rendering browser. Unknown tags are unwrapped, not deleted, so the
 * text itself always survives.
 */
const ALLOWED_RICH_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'span', 'div']);

export function sanitiseRichText(html: string | null | undefined): string {
  if (!html) return '—';
  return String(html)
    // Drop script/style outright, contents included.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Keep only allowed tags, and strip EVERY attribute (so no src/href/style/on* survives).
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g, (_m, slash: string, rawTag: string, selfClose: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_RICH_TAGS.has(tag)) return '';
      if (tag === 'br') return '<br />';
      return slash ? `</${tag}>` : selfClose ? `<${tag} />` : `<${tag}>`;
    });
}
