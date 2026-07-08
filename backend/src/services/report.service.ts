import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { formatDate } from '../utils/dateUtils';
import { exportToCsv } from '../utils/csvExporter';
import { exportToExcel } from '../utils/excelExporter';
import { renderPdfFromHtml } from '../utils/pdfGenerator';
import { buildHeaderTemplate, buildFooterTemplate, escapeHtml } from '../utils/reportHeader';
import { generateReportReference } from '../utils/certificateNumber';
import { getOrgInfo } from './systemConfig.service';

export interface ReportFilters {
  topicId?: string;
  departmentId?: string;
  roleId?: string;
  userId?: string;
  // CR-R2: additional org filters
  locationId?: string;
  designationId?: string; // functional role
  supervisorId?: string; // reporting manager
  from?: Date;
  to?: Date;
  includeInactive?: boolean;
}

interface ReportData {
  title: string;
  columns: Array<{ header: string; key: string }>;
  rows: Array<Record<string, unknown>>;
}

export const REPORT_TYPES = [
  'topic-wise-status',
  'department-wise-status',
  'pending-completed',
  'role-wise-status',
  'designation-wise-status',
  'version-wise-topic',
  'employee-jd-history',
  'training-competency',
  'overdue',
  'audit-trail',
  'induction',
  'employee-dashboard',
  'feedback-analysis',
  'bundle-assignment-status',
  'employee-training-history',
  'effective-to-completion-days', // CR-54
  'training-type-wise-status', // CR-55
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

async function maps() {
  const [users, topics, depts, locations, designations] = await Promise.all([
    prisma.user.findMany({ where: { isDeleted: false } }),
    prisma.trainingTopic.findMany({ where: { isDeleted: false } }),
    prisma.department.findMany({ where: { isDeleted: false } }),
    prisma.location.findMany({ where: { isDeleted: false } }),
    prisma.designationMaster.findMany({ where: { isDeleted: false } }),
  ]);
  return {
    users: new Map(users.map((u) => [u.id, u])),
    topics: new Map(topics.map((t) => [t.id, t])),
    depts: new Map(depts.map((d) => [d.id, d])),
    locations: new Map(locations.map((l) => [l.id, l])),
    designations: new Map(designations.map((d) => [d.id, d])),
  };
}

type Maps = Awaited<ReturnType<typeof maps>>;

/** CR-R1 name resolution helpers (resolve raw ids to readable names). */
function deptName(m: Maps, id?: string | null) {
  return id ? m.depts.get(id)?.name ?? '' : '';
}
function locationName(m: Maps, id?: string | null) {
  return id ? m.locations.get(id)?.name ?? '' : '';
}
function designationDisplay(m: Maps, id?: string | null) {
  return id ? m.designations.get(id)?.displayName ?? '' : '';
}
function supervisorName(m: Maps, id?: string | null) {
  return id ? m.users.get(id)?.fullName ?? '' : '';
}

/** A user's functional-role ids: primary designationId plus designationIds[] array. */
function userDesignationIds(u: { designationId?: string | null; designationIds?: unknown }): string[] {
  const ids = new Set<string>();
  if (u.designationId) ids.add(u.designationId);
  if (Array.isArray(u.designationIds)) for (const d of u.designationIds) if (typeof d === 'string') ids.add(d);
  return [...ids];
}

/** CR-R1: readable org columns for a user, used by user/training reports. */
function userOrgCols(m: Maps, userId: string) {
  const u = m.users.get(userId);
  return {
    department: deptName(m, u?.departmentId),
    location: locationName(m, u?.locationId),
    functionalRole: designationDisplay(m, u?.designationId),
    reportingManager: supervisorName(m, u?.supervisorId),
  };
}

function dateRange(field: string, f: ReportFilters) {
  if (!f.from && !f.to) return {};
  const r: Record<string, Date> = {};
  if (f.from) r.gte = f.from;
  if (f.to) r.lte = f.to;
  return { [field]: r };
}

/** Build a report's tabular data. */
export async function buildReport(type: ReportType, f: ReportFilters): Promise<ReportData> {
  const m = await maps();
  const activeUser = (id: string) => (f.includeInactive ? true : m.users.get(id)?.isActive ?? false);

  // CR-R2: org-scope predicate over a user id (location / department / functional role / reporting manager).
  const matchesUserScope = (id: string) => {
    const u = m.users.get(id);
    if (!u) return false;
    // A specific user filter narrows EVERY user-based report to that person (applied here
    // so it works uniformly, not only in the reports that special-case it).
    if (f.userId && u.id !== f.userId) return false;
    if (f.locationId && u.locationId !== f.locationId) return false;
    if (f.departmentId && u.departmentId !== f.departmentId) return false;
    if (f.supervisorId && u.supervisorId !== f.supervisorId) return false;
    if (f.designationId && !userDesignationIds(u).includes(f.designationId)) return false;
    return true;
  };
  /** Combined gate: active (unless includeInactive) AND in org scope. */
  const userPasses = (id: string) => activeUser(id) && matchesUserScope(id);

  switch (type) {
    case 'topic-wise-status': {
      const a = await prisma.trainingAssignment.findMany({
        where: { isDeleted: false, ...(f.topicId ? { topicId: f.topicId } : {}), ...dateRange('createdAt', f) },
      });
      const rows = a
        .filter((x) => userPasses(x.userId))
        .map((x) => ({
          topicCode: m.topics.get(x.topicId)?.topicCode ?? '',
          topicTitle: m.topics.get(x.topicId)?.title ?? '',
          _userId: x.userId, _topicId: x.topicId,
          employee: m.users.get(x.userId)?.fullName ?? '',
          employeeId: m.users.get(x.userId)?.employeeId ?? '',
          ...userOrgCols(m, x.userId),
          status: x.status,
          dueDate: formatDate(x.dueDate),
        }));
      return {
        title: 'Training Topic-Wise Status Report',
        columns: [
          { header: 'Topic Code', key: 'topicCode' },
          { header: 'Topic', key: 'topicTitle' },
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Status', key: 'status' },
          { header: 'Due Date', key: 'dueDate' },
        ],
        rows,
      };
    }

    case 'department-wise-status': {
      const a = await prisma.trainingAssignment.findMany({ where: { isDeleted: false } });
      const agg = new Map<string, { total: number; completed: number }>();
      for (const x of a) {
        if (!userPasses(x.userId)) continue;
        const dept = m.users.get(x.userId)?.departmentId ?? 'unknown';
        const e = agg.get(dept) ?? { total: 0, completed: 0 };
        e.total++;
        if (x.status === 'COMPLETED') e.completed++;
        agg.set(dept, e);
      }
      const rows = [...agg.entries()].map(([deptId, v]) => ({
        department: m.depts.get(deptId)?.name ?? deptId,
        totalAssigned: v.total,
        completed: v.completed,
        compliancePercent: v.total ? Number(((v.completed / v.total) * 100).toFixed(1)) : 0,
      }));
      return {
        title: 'Department-Wise Training Status Report',
        columns: [
          { header: 'Department', key: 'department' },
          { header: 'Total Assigned', key: 'totalAssigned' },
          { header: 'Completed', key: 'completed' },
          { header: 'Compliance %', key: 'compliancePercent' },
        ],
        rows,
      };
    }

    case 'pending-completed': {
      const a = await prisma.trainingAssignment.findMany({
        where: { isDeleted: false, ...(f.userId ? { userId: f.userId } : {}) },
      });
      const rows = a
        .filter((x) => userPasses(x.userId))
        .map((x) => ({
          _userId: x.userId, _topicId: x.topicId,
          employee: m.users.get(x.userId)?.fullName ?? '',
          employeeId: m.users.get(x.userId)?.employeeId ?? '',
          ...userOrgCols(m, x.userId),
          topic: m.topics.get(x.topicId)?.title ?? '',
          status: x.status,
          dueDate: formatDate(x.dueDate),
        }));
      return {
        title: 'Pending / Completed Training Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Topic', key: 'topic' },
          { header: 'Status', key: 'status' },
          { header: 'Due Date', key: 'dueDate' },
        ],
        rows,
      };
    }

    case 'role-wise-status': {
      const urs = await prisma.userRole.findMany({ where: { isActive: true, ...(f.roleId ? { roleId: f.roleId } : {}) } });
      const userIds = new Set(urs.map((u) => u.userId));
      const a = await prisma.trainingAssignment.findMany({ where: { isDeleted: false, userId: { in: [...userIds] } } });
      const agg = new Map<string, { total: number; completed: number }>();
      for (const x of a) {
        const e = agg.get(x.userId) ?? { total: 0, completed: 0 };
        e.total++;
        if (x.status === 'COMPLETED') e.completed++;
        agg.set(x.userId, e);
      }
      const rows = [...agg.entries()].filter(([id]) => userPasses(id)).map(([id, v]) => ({
        _userId: id,
        employee: m.users.get(id)?.fullName ?? '',
        employeeId: m.users.get(id)?.employeeId ?? '',
        ...userOrgCols(m, id),
        totalAssigned: v.total,
        completed: v.completed,
        compliancePercent: v.total ? Number(((v.completed / v.total) * 100).toFixed(1)) : 0,
      }));
      return {
        title: 'Job Role / Function-Wise Training Status Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Total Assigned', key: 'totalAssigned' },
          { header: 'Completed', key: 'completed' },
          { header: 'Compliance %', key: 'compliancePercent' },
        ],
        rows,
      };
    }

    case 'designation-wise-status': {
      const designations = await prisma.designationMaster.findMany({ where: { isDeleted: false } });
      const desigName = new Map(designations.map((d) => [d.id, d.displayName]));
      const a = await prisma.trainingAssignment.findMany({ where: { isDeleted: false } });
      const agg = new Map<string, { total: number; completed: number }>();
      for (const x of a) {
        if (!userPasses(x.userId)) continue;
        const dz = m.users.get(x.userId)?.designationId ?? 'unassigned';
        const e = agg.get(dz) ?? { total: 0, completed: 0 };
        e.total++;
        if (x.status === 'COMPLETED') e.completed++;
        agg.set(dz, e);
      }
      const rows = [...agg.entries()].map(([dz, v]) => ({
        designation: dz === 'unassigned' ? '(Unassigned)' : desigName.get(dz) ?? dz,
        totalAssigned: v.total,
        completed: v.completed,
        compliancePercent: v.total ? Number(((v.completed / v.total) * 100).toFixed(1)) : 0,
      }));
      return {
        title: 'Designation-Wise Training Status Report',
        columns: [
          { header: 'Designation', key: 'designation' },
          { header: 'Total Assigned', key: 'totalAssigned' },
          { header: 'Completed', key: 'completed' },
          { header: 'Compliance %', key: 'compliancePercent' },
        ],
        rows,
      };
    }

    case 'version-wise-topic': {
      const attempts = await prisma.assessmentAttempt.findMany({
        where: { isDeleted: false, isPassed: true, ...(f.topicId ? { topicId: f.topicId } : {}) },
      });
      const rows = attempts.filter((x) => userPasses(x.userId)).map((x) => ({
        topic: m.topics.get(x.topicId)?.title ?? '',
        topicVersion: x.topicVersion,
        _userId: x.userId, _topicId: x.topicId,
          employee: m.users.get(x.userId)?.fullName ?? '',
        employeeId: m.users.get(x.userId)?.employeeId ?? '',
        ...userOrgCols(m, x.userId),
        completedAt: formatDate(x.completedAt),
        score: x.score,
      }));
      return {
        title: 'Version-Wise Training Topic Report',
        columns: [
          { header: 'Topic', key: 'topic' },
          { header: 'Version', key: 'topicVersion' },
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Completed', key: 'completedAt' },
          { header: 'Score', key: 'score' },
        ],
        rows,
      };
    }

    case 'employee-jd-history': {
      const jds = await prisma.jobDescription.findMany({
        where: { ...(f.userId ? { userId: f.userId } : {}) },
        orderBy: [{ userId: 'asc' }, { version: 'desc' }],
      });
      const rows = jds.filter((j) => userPasses(j.userId)).map((j) => ({
        _userId: j.userId,
        employee: m.users.get(j.userId)?.fullName ?? '',
        title: j.title,
        version: j.version,
        status: j.status,
        approvedBy: j.approvedBy ? m.users.get(j.approvedBy)?.fullName ?? j.approvedBy : '',
        approvedAt: formatDate(j.approvedAt),
      }));
      return {
        title: 'Employee JD History Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'JD Title', key: 'title' },
          { header: 'Version', key: 'version' },
          { header: 'Status', key: 'status' },
          { header: 'Approved By', key: 'approvedBy' },
          { header: 'Approved At', key: 'approvedAt' },
        ],
        rows,
      };
    }

    case 'training-competency': {
      const a = await prisma.trainingAssignment.findMany({
        where: { isDeleted: false, status: 'COMPLETED', ...(f.topicId ? { topicId: f.topicId } : {}), ...(f.userId ? { userId: f.userId } : {}) },
      });
      const rows = a.filter((x) => userPasses(x.userId)).map((x) => ({
        _userId: x.userId, _topicId: x.topicId,
          employee: m.users.get(x.userId)?.fullName ?? '',
        employeeId: m.users.get(x.userId)?.employeeId ?? '',
        ...userOrgCols(m, x.userId),
        topic: m.topics.get(x.topicId)?.title ?? '',
        topicCode: m.topics.get(x.topicId)?.topicCode ?? '',
        completedAt: formatDate(x.updatedAt),
      }));
      return {
        title: 'Training Competency Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Topic', key: 'topic' },
          { header: 'Topic Code', key: 'topicCode' },
          { header: 'Completed', key: 'completedAt' },
        ],
        rows,
      };
    }

    case 'overdue': {
      const a = await prisma.trainingAssignment.findMany({ where: { isDeleted: false, status: 'OVERDUE' } });
      const rows = a.filter((x) => userPasses(x.userId)).map((x) => ({
        ...userOrgCols(m, x.userId),
        _userId: x.userId, _topicId: x.topicId,
          employee: m.users.get(x.userId)?.fullName ?? '',
        employeeId: m.users.get(x.userId)?.employeeId ?? '',
        topic: m.topics.get(x.topicId)?.title ?? '',
        dueDate: formatDate(x.dueDate),
      }));
      return {
        title: 'Overdue Training Report',
        columns: [
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Topic', key: 'topic' },
          { header: 'Due Date', key: 'dueDate' },
        ],
        rows,
      };
    }

    case 'audit-trail': {
      const logs = await prisma.auditTrail.findMany({
        where: { ...dateRange('timestamp', f) },
        orderBy: { timestamp: 'desc' },
        take: 5000,
      });
      const rows = logs.map((l) => ({
        timestamp: formatDate(l.timestamp),
        user: l.userFullName,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId ?? '',
        reason: l.reasonForChange ?? '',
      }));
      return {
        title: 'Audit Trail Report',
        columns: [
          { header: 'Timestamp', key: 'timestamp' },
          { header: 'User', key: 'user' },
          { header: 'Action', key: 'action' },
          { header: 'Entity', key: 'entityType' },
          { header: 'Entity ID', key: 'entityId' },
          { header: 'Reason', key: 'reason' },
        ],
        rows,
      };
    }

    case 'induction': {
      const inductionTopics = new Set([...m.topics.values()].filter((t) => t.trainingType === 'INDUCTION').map((t) => t.id));
      const certs = await prisma.certificate.findMany({ where: { isDeleted: false, certificateType: 'INDUCTION' } });
      const rows = certs.map((c) => ({
        _userId: c.userId, _topicId: c.topicId,
        employee: m.users.get(c.userId)?.fullName ?? '',
        employeeId: m.users.get(c.userId)?.employeeId ?? '',
        topic: m.topics.get(c.topicId)?.title ?? '',
        certificateNumber: c.certificateNumber,
        issuedAt: formatDate(c.issuedAt),
      }));
      return {
        title: 'Induction Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Induction Topic', key: 'topic' },
          { header: 'Certificate No.', key: 'certificateNumber' },
          { header: 'Issued', key: 'issuedAt' },
        ],
        rows: rows.length ? rows : [{ employee: '', employeeId: '', topic: `${inductionTopics.size} induction topics defined`, certificateNumber: '', issuedAt: '' }],
      };
    }

    case 'employee-dashboard': {
      if (!f.userId) throw AppError.badRequest('userId is required for the employee dashboard report.');
      const a = await prisma.trainingAssignment.findMany({ where: { isDeleted: false, userId: f.userId } });
      const byStatus: Record<string, number> = {};
      for (const x of a) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
      const rows = Object.entries(byStatus).map(([status, count]) => ({ status, count }));
      return {
        title: 'Employee Training Dashboard',
        columns: [
          { header: 'Status', key: 'status' },
          { header: 'Count', key: 'count' },
        ],
        rows,
      };
    }

    case 'feedback-analysis': {
      const forms = await prisma.feedbackForm.findMany({ where: { isDeleted: false, ...(f.topicId ? { topicId: f.topicId } : {}) } });
      const rows = [];
      for (const form of forms) {
        const responseCount = await prisma.feedbackResponse.count({ where: { formId: form.id, isDeleted: false } });
        rows.push({ form: form.title, topic: m.topics.get(form.topicId)?.title ?? '', responseCount });
      }
      return {
        title: 'Feedback Analysis Report',
        columns: [
          { header: 'Form', key: 'form' },
          { header: 'Topic', key: 'topic' },
          { header: 'Responses', key: 'responseCount' },
        ],
        rows,
      };
    }

    case 'bundle-assignment-status': {
      const bundles = await prisma.topicBundle.findMany({ where: { isDeleted: false } });
      const links = await prisma.bundleTopic.findMany({ where: { isDeleted: false } });
      const topicsByBundle = new Map<string, string[]>();
      for (const l of links) {
        const arr = topicsByBundle.get(l.bundleId) ?? [];
        arr.push(l.topicId);
        topicsByBundle.set(l.bundleId, arr);
      }
      const rows = [];
      for (const b of bundles) {
        const tIds = topicsByBundle.get(b.id) ?? [];
        const assignments = tIds.length
          ? await prisma.trainingAssignment.findMany({ where: { isDeleted: false, topicId: { in: tIds } } })
          : [];
        const completed = assignments.filter((a) => a.status === 'COMPLETED').length;
        const pending = assignments.filter((a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS').length;
        const overdue = assignments.filter((a) => a.status === 'OVERDUE').length;
        rows.push({
          bundle: b.name,
          topics: tIds.length,
          totalAssignments: assignments.length,
          completed,
          pending,
          overdue,
          compliancePercent: assignments.length ? Number(((completed / assignments.length) * 100).toFixed(1)) : 0,
        });
      }
      return {
        title: 'Bundle Assignment Status Report',
        columns: [
          { header: 'Bundle', key: 'bundle' },
          { header: 'Topics', key: 'topics' },
          { header: 'Total Assignments', key: 'totalAssignments' },
          { header: 'Completed', key: 'completed' },
          { header: 'Pending', key: 'pending' },
          { header: 'Overdue', key: 'overdue' },
          { header: 'Compliance %', key: 'compliancePercent' },
        ],
        rows,
      };
    }

    case 'employee-training-history': {
      const a = await prisma.trainingAssignment.findMany({
        where: { isDeleted: false, ...(f.userId ? { userId: f.userId } : {}), ...(f.topicId ? { topicId: f.topicId } : {}) },
        orderBy: { createdAt: 'desc' },
      });
      const attempts = await prisma.assessmentAttempt.findMany({ where: { isDeleted: false } });
      const key = (u: string, t: string) => `${u}:${t}`;
      const best = new Map<string, (typeof attempts)[number]>();
      for (const at of attempts) {
        const k = key(at.userId, at.topicId);
        const cur = best.get(k);
        if (!cur || (at.score ?? -1) > (cur.score ?? -1)) best.set(k, at);
      }
      const rows = a
        .filter((x) => userPasses(x.userId))
        .map((x) => {
          const at = best.get(key(x.userId, x.topicId));
          const topic = m.topics.get(x.topicId);
          const eff = topic?.effectiveDate ?? null;
          const comp = at?.completedAt ?? null;
          const days = eff && comp ? Math.round((comp.getTime() - eff.getTime()) / 86_400_000) : '';
          return {
            _userId: x.userId, _topicId: x.topicId,
          employee: m.users.get(x.userId)?.fullName ?? '',
            employeeId: m.users.get(x.userId)?.employeeId ?? '',
            ...userOrgCols(m, x.userId),
            topic: topic?.title ?? '',
            topicCode: topic?.topicCode ?? '',
            version: at?.topicVersion ?? topic?.currentVersion ?? '',
            status: x.status,
            score: at?.score ?? '',
            effectiveDate: formatDate(eff),
            completedAt: formatDate(comp),
            daysToComplete: days,
            dueDate: formatDate(x.dueDate),
          };
        });
      return {
        title: 'Employee Training History Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Topic', key: 'topic' },
          { header: 'Topic Code', key: 'topicCode' },
          { header: 'Version', key: 'version' },
          { header: 'Status', key: 'status' },
          { header: 'Score', key: 'score' },
          { header: 'Effective Date', key: 'effectiveDate' },
          { header: 'Completed', key: 'completedAt' },
          { header: 'Days to Complete', key: 'daysToComplete' },
          { header: 'Due Date', key: 'dueDate' },
        ],
        rows,
      };
    }

    // CR-54: days between a topic's effective date and each completion date.
    case 'effective-to-completion-days': {
      const attempts = await prisma.assessmentAttempt.findMany({
        where: { isDeleted: false, isPassed: true, completedAt: { not: null }, ...(f.topicId ? { topicId: f.topicId } : {}) },
        orderBy: { completedAt: 'desc' },
      });
      const rows = attempts
        .filter((at) => userPasses(at.userId))
        .map((at) => {
          const topic = m.topics.get(at.topicId);
          const eff = topic?.effectiveDate ?? null;
          const comp = at.completedAt ?? null;
          const days = eff && comp ? Math.round((comp.getTime() - eff.getTime()) / 86_400_000) : '';
          return {
            _userId: at.userId, _topicId: at.topicId,
            employee: m.users.get(at.userId)?.fullName ?? '',
            employeeId: m.users.get(at.userId)?.employeeId ?? '',
            ...userOrgCols(m, at.userId),
            topic: topic?.title ?? '',
            topicCode: topic?.topicCode ?? '',
            effectiveDate: formatDate(eff),
            completedAt: formatDate(comp),
            days,
          };
        });
      return {
        title: 'Effective-to-Completion Days Report',
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee ID', key: 'employeeId' },
          { header: 'Department', key: 'department' },
          { header: 'Location', key: 'location' },
          { header: 'Functional Role', key: 'functionalRole' },
          { header: 'Reporting Manager', key: 'reportingManager' },
          { header: 'Topic', key: 'topic' },
          { header: 'Topic Code', key: 'topicCode' },
          { header: 'Effective Date', key: 'effectiveDate' },
          { header: 'Completed', key: 'completedAt' },
          { header: 'Days to Complete', key: 'days' },
        ],
        rows,
      };
    }

    // CR-55: assignment status aggregated by training type.
    case 'training-type-wise-status': {
      const assignments = await prisma.trainingAssignment.findMany({ where: { isDeleted: false } });
      const agg = new Map<string, { total: number; completed: number }>();
      for (const a of assignments) {
        if (!userPasses(a.userId)) continue;
        const tt = m.topics.get(a.topicId)?.trainingType ?? 'UNKNOWN';
        const cur = agg.get(tt) ?? { total: 0, completed: 0 };
        cur.total += 1;
        if (a.status === 'COMPLETED') cur.completed += 1;
        agg.set(tt, cur);
      }
      const rows = Array.from(agg.entries()).map(([trainingType, v]) => ({
        trainingType,
        total: v.total,
        completed: v.completed,
        compliance: v.total ? `${Math.round((v.completed / v.total) * 100)}%` : '0%',
      }));
      return {
        title: 'Training-Type-wise Status Report',
        columns: [
          { header: 'Training Type', key: 'trainingType' },
          { header: 'Total Assigned', key: 'total' },
          { header: 'Completed', key: 'completed' },
          { header: 'Compliance %', key: 'compliance' },
        ],
        rows,
      };
    }

    default:
      throw AppError.badRequest(`Unknown report type: ${type}`);
  }
}

function tableHtml(title: string, columns: ReportData['columns'], rows: ReportData['rows']): string {
  return `<html><head><style>
    body{font-family:Arial;font-size:10px;} h2{font-size:14px;}
    table{width:100%;border-collapse:collapse;margin-top:8px;}
    th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;} th{background:#eef2f1;}
  </style></head><body><h2>${escapeHtml(title)}</h2>
  <table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')}</tr></thead>
  <tbody>${rows
    .map((r) => `<tr>${columns.map((c) => `<td>${escapeHtml(String(r[c.key] ?? ''))}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></body></html>`;
}

export interface ExportResult {
  contentType: string;
  filename: string;
  body: Buffer | string;
  rowCount: number;
}

export async function exportReport(
  type: ReportType,
  format: string,
  filters: ReportFilters,
  user: { fullName: string; employeeId: string },
  isPrint = false,
): Promise<ExportResult> {
  const data = await buildReport(type, filters);
  const fmt = format.toLowerCase();

  if (fmt === 'csv') {
    return { contentType: 'text/csv', filename: `${type}.csv`, body: exportToCsv(data.columns, data.rows, { generatedBy: user.fullName }), rowCount: data.rows.length };
  }
  if (fmt === 'xls' || fmt === 'xlsx') {
    // Tab name is capped at 31 chars by the .xlsx format (sanitised); the FULL title is
    // preserved as a title row inside the sheet.
    const buf = await exportToExcel(data.columns, data.rows, data.title, data.title, { generatedBy: user.fullName });
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${type}.xlsx`,
      body: buf,
      rowCount: data.rows.length,
    };
  }

  // PDF (also the "print" path)
  const org = await getOrgInfo();
  const cfg = {
    orgName: org.name,
    orgLogoPath: /^(https?:|data:)/.test(org.logoPath) ? org.logoPath : undefined,
    reportTitle: data.title,
    referenceNumber: generateReportReference(),
    generatedByName: user.fullName,
    generatedByEmployeeId: user.employeeId,
    generatedAt: new Date(),
    timezone: org.timezone,
    printedByName: isPrint ? user.fullName : undefined,
  };
  const pdf = await renderPdfFromHtml(tableHtml(data.title, data.columns, data.rows), {
    headerHtml: buildHeaderTemplate(cfg),
    footerHtml: buildFooterTemplate(cfg),
    landscape: true,
  });
  return { contentType: 'application/pdf', filename: `${type}.pdf`, body: pdf, rowCount: data.rows.length };
}
