import { Request } from 'express';
import { Prisma } from '@prisma/client';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { hasPermission } from '../utils/permissions';
import { isOrgWideUserManager, directReportIds } from '../utils/accessScope';
import { signFromRequest } from './eSignature.service';
import { notifyJdPendingApproval, notifyJdDecision } from './notification.service';
import { JD_ACK_SENTENCE } from '@izlearn/shared';
import type {
  CreateJDInput,
  UpdateJDInput,
  JDTransitionInput,
  JDTemplateInput,
  AcknowledgeJDInput,
  AssignJDFromTemplateInput,
  PaginationQuery,
  PermissionMatrix,
} from '@izlearn/shared';

/**
 * Job descriptions (Module 4) — per-employee JDs with a controlled lifecycle
 * (DRAFT → UNDER_REVIEW → APPROVED / REJECTED → OBSOLETE) plus reusable master
 * templates keyed by department + role.
 *
 *  - rich-text content is sanitised with DOMPurify before persistence (stored XSS).
 *  - APPROVE / REJECT are e-signed and set an explicit audit action override.
 *  - edits are only permitted while DRAFT or REJECTED and require a reason.
 *  - JDs are part of the permanent record and are never deleted.
 *  - plain CRUD writes are captured by the Prisma audit middleware automatically.
 */

// ---- Job descriptions -------------------------------------------------------

export async function listJDs(
  q: PaginationQuery & { userId?: string; status?: string },
  requester?: { id: string; permissions?: Record<string, Record<string, boolean>> },
) {
  // JD-6: filter by lifecycle state SERVER-SIDE (default: active = APPROVED/UNDER_REVIEW),
  // so paginated pages and totals are correct instead of the old client-side filter that
  // ran after pagination and left pages half-empty once versioning produced OBSOLETE rows.
  const statusFilter: Prisma.JobDescriptionWhereInput =
    q.status === 'all'
      ? {}
      : q.status === 'inactive'
        ? { status: { in: ['DRAFT', 'OBSOLETE', 'REJECTED'] } }
        : { status: { in: ['APPROVED', 'UNDER_REVIEW'] } };
  const where: Prisma.JobDescriptionWhereInput = {
    isDeleted: false,
    ...statusFilter,
    ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  // Item 9 (permission-driven, no role names): an org-wide user manager sees every JD;
  // anyone else is limited to their direct reports' JDs. A new custom role scopes from
  // its granted permissions alone.
  if (requester && !isOrgWideUserManager(requester.permissions as PermissionMatrix)) {
    let allowed = await directReportIds(requester.id);
    // Honour an explicit ?userId filter only when it targets a direct report.
    if (q.userId) allowed = allowed.includes(q.userId) ? [q.userId] : [];
    // No reports (or a disallowed filter) must yield NO rows, never the whole org.
    where.userId = { in: allowed.length ? allowed : ['__no_match__'] };
  } else if (q.userId) {
    where.userId = q.userId;
  }
  const [data, total] = await Promise.all([
    prisma.jobDescription.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.jobDescription.count({ where }),
  ]);
  // Resolve user + approver ids → names so the list shows people, not UUIDs (CR-JD3).
  const ids = Array.from(
    new Set([...data.map((d) => d.userId), ...data.map((d) => d.approvedBy)].filter(Boolean) as string[]),
  );
  const people = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(people.map((u) => [u.id, u.fullName]));
  const withNames = data.map((d) => ({
    ...d,
    userFullName: nameById.get(d.userId) ?? null,
    approvedByName: d.approvedBy ? nameById.get(d.approvedBy) ?? null : null,
  }));
  return { data: withNames, total, page: q.page, pageSize: q.pageSize };
}

export async function getJD(id: string) {
  const jd = await prisma.jobDescription.findFirst({ where: { id, isDeleted: false } });
  if (!jd) throw AppError.notFound('Job description not found');
  return jd;
}

export async function createJD(input: CreateJDInput, createdBy: string) {
  return prisma.jobDescription.create({
    data: {
      userId: input.userId,
      departmentId: input.departmentId,
      roleId: input.roleId,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
      version: 1,
      status: 'DRAFT',
      createdBy,
    },
  });
}

/** CR-50: the logged-in user's current (non-obsolete) assigned Job Description. */
export async function getMyJD(userId: string) {
  return prisma.jobDescription.findFirst({
    where: { userId, isDeleted: false, status: { not: 'OBSOLETE' } },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Resolve the referenced people (owner, assigner, approver) + department + functional
 * role for a set of JDs, so every consumer (the My-JD list, version history, printouts)
 * shows names instead of UUIDs and the printout can mirror the JD module exactly.
 */
async function enrichJdsForDisplay<
  T extends {
    userId: string;
    assignedBy: string | null;
    approvedBy: string | null;
    createdBy: string;
    departmentId: string | null;
    functionalRoleId: string | null;
  },
>(jds: T[]) {
  // "Assigned by" = whoever assigned it; fall back to the approver, then the creator,
  // so JDs that became APPROVED via the review flow (assignedBy unset) still show a name.
  const assignerOf = (j: T) => j.assignedBy ?? j.approvedBy ?? j.createdBy ?? null;
  const personIds = Array.from(
    new Set([...jds.map((j) => j.userId), ...jds.map(assignerOf), ...jds.map((j) => j.approvedBy)].filter(Boolean) as string[]),
  );
  const deptIds = Array.from(new Set(jds.map((j) => j.departmentId).filter(Boolean) as string[]));
  const roleIds = Array.from(new Set(jds.map((j) => j.functionalRoleId).filter(Boolean) as string[]));
  const [people, depts, roles] = await Promise.all([
    personIds.length
      ? prisma.user.findMany({ where: { id: { in: personIds } }, select: { id: true, fullName: true, employeeId: true } })
      : Promise.resolve([]),
    deptIds.length
      ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    roleIds.length
      ? prisma.designationMaster.findMany({ where: { id: { in: roleIds } }, select: { id: true, displayName: true } })
      : Promise.resolve([]),
  ]);
  const personById = new Map(people.map((u) => [u.id, u]));
  const deptById = new Map(depts.map((d) => [d.id, d.name]));
  const roleById = new Map(roles.map((r) => [r.id, r.displayName]));
  return jds.map((j) => {
    const aid = assignerOf(j);
    const owner = personById.get(j.userId);
    return {
      ...j,
      assignedByName: aid ? personById.get(aid)?.fullName ?? null : null,
      approvedByName: j.approvedBy ? personById.get(j.approvedBy)?.fullName ?? null : null,
      employeeName: owner?.fullName ?? null,
      employeeCode: owner?.employeeId ?? null,
      departmentName: j.departmentId ? deptById.get(j.departmentId) ?? null : null,
      functionalRoleName: j.functionalRoleId ? roleById.get(j.functionalRoleId) ?? null : null,
    };
  });
}

/**
 * B1: every non-obsolete JD assigned to the logged-in user (supports holding more
 * than one active JD), newest first, with the assigning supervisor's name resolved.
 */
export async function listMyJDs(userId: string) {
  const jds = await prisma.jobDescription.findMany({
    where: { userId, isDeleted: false, status: { not: 'OBSOLETE' } },
    orderBy: [{ assignedAt: 'desc' }, { version: 'desc' }, { createdAt: 'desc' }],
  });
  return enrichJdsForDisplay(jds);
}

/**
 * Visibility-gated read of another user's (non-obsolete) JDs — mirrors the CV rule:
 * readable by the owner, the owner's direct supervisor, or a SUPER_ADMIN. Lets a
 * supervisor open a team member's JD just like their CV.
 */
type JdRequester = { id: string; permissions?: Record<string, Record<string, boolean>> };

/**
 * Authorise viewing another user's JD records (permission-driven, no role names):
 * always your own; org-wide user managers see anyone; everyone else only their DIRECT
 * reports. Used by the single-JD read, the history endpoint and the team JD view so they
 * all enforce the SAME scope (JD-3 / JD-4).
 */
async function assertCanViewUserJDs(targetUserId: string, requester: JdRequester) {
  if (targetUserId === requester.id) return;
  if (isOrgWideUserManager(requester.permissions as PermissionMatrix)) return;
  const target = await prisma.user.findFirst({ where: { id: targetUserId, isDeleted: false }, select: { supervisorId: true } });
  if (!target) throw AppError.notFound('User not found');
  if (target.supervisorId !== requester.id) {
    throw AppError.forbidden('You may only view your own JD or the JDs of your direct reports.');
  }
}

export async function getUserJDsForViewer(targetUserId: string, requester: JdRequester) {
  await assertCanViewUserJDs(targetUserId, requester);
  return listMyJDs(targetUserId);
}

/** JD-3: a single JD by id, scoped to the same viewers as the list/history endpoints. */
export async function getJDForViewer(id: string, requester: JdRequester) {
  const jd = await getJD(id);
  await assertCanViewUserJDs(jd.userId, requester);
  return jd;
}

/** JD-4: a user's JD version history, viewer-scoped (was unscoped). */
export async function getEmployeeJDHistoryForViewer(targetUserId: string, requester: JdRequester) {
  await assertCanViewUserJDs(targetUserId, requester);
  return getEmployeeJDHistory(targetUserId);
}

/** JD-5: authorise assigning a JD to a user — org-wide managers, or the user's direct supervisor. */
async function assertCanAssignToUser(targetUserId: string, req: Request) {
  if (isOrgWideUserManager(req.user!.permissions as PermissionMatrix)) return;
  const target = await prisma.user.findFirst({ where: { id: targetUserId, isDeleted: false }, select: { supervisorId: true } });
  if (!target || target.supervisorId !== req.user!.id) {
    throw AppError.forbidden('You may only assign Job Descriptions to your direct reports.');
  }
}

/**
 * I4/I5: assign a JD to a user from a chosen template. The title/content/department
 * come from the (editable) request — the edited copy is stored on the JD instance and
 * never changes the template. Assigned directly as APPROVED (no separate review step),
 * e-signed (assign), and the user is notified to acknowledge. Does not obsolete other
 * JDs — a user may hold more than one active JD (B1).
 */
export async function assignJDFromTemplate(input: AssignJDFromTemplateInput, req: Request) {
  const user = await prisma.user.findFirst({ where: { id: input.userId, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  await assertCanAssignToUser(input.userId, req); // JD-5: direct-report / org-wide only
  const template = await prisma.jDTemplate.findFirst({ where: { id: input.templateId, isDeleted: false } });
  if (!template) throw AppError.notFound('Job-description template not found');

  // Controlled, direct assignment — two-component e-signature.
  await signFromRequest(req, 'User', input.userId, 'Approved');

  // Item 2: a newly assigned JD is a new controlled document → it starts at v1. The
  // version only advances when this JD is later revised (see updateJD), so the number
  // the employee sees reflects the JD's own revision history, not a running count of
  // how many JDs they have ever been assigned.
  auditContext.setActionOverride('CREATE');
  const jd = await prisma.jobDescription.create({
    data: {
      userId: input.userId,
      departmentId: input.departmentId ?? template.departmentId ?? user.departmentId,
      functionalRoleId: template.functionalRoleId,
      sourceTemplateId: template.id,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
      version: 1,
      status: 'APPROVED',
      approvedBy: req.user!.id,
      approvedAt: new Date(),
      assignedBy: req.user!.id,
      assignedAt: new Date(),
      createdBy: req.user!.id,
    },
  });
  await notifyJdDecision(input.userId, jd.title, 'assigned — please acknowledge');
  return jd;
}

/**
 * D-JD1 / CR-50: assign a Functional Role to a user. The matching JD template
 * (functional role, preferring a department match) is auto-assigned as an APPROVED
 * JD (D-JD2 — the template is the controlled master), the prior JD is obsoleted,
 * and the user is notified to acknowledge. E-signed (assign).
 */
export async function assignFunctionalRole(userId: string, functionalRoleId: string, req: Request) {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!user) throw AppError.notFound('User not found');
  await assertCanAssignToUser(userId, req); // JD-5: direct-report / org-wide only
  const fr = await prisma.designationMaster.findFirst({ where: { id: functionalRoleId, isDeleted: false } });
  if (!fr) throw AppError.notFound('Functional role not found');

  const templates = await prisma.jDTemplate.findMany({ where: { functionalRoleId, isDeleted: false, isActive: true } });
  const template =
    templates.find((t) => t.departmentId === user.departmentId) ?? templates.find((t) => !t.departmentId) ?? templates[0];

  if (!template) {
    // Set the functional role but warn — a JD cannot be assigned without a template.
    await prisma.user.update({ where: { id: userId }, data: { designationId: functionalRoleId } });
    throw AppError.badRequest('Functional role set, but no JD template exists for it yet. Create a JD template for this functional role to assign a Job Description.');
  }

  // Controlled assignment — two-component e-signature.
  await signFromRequest(req, 'User', userId, 'Approved');
  await prisma.user.update({ where: { id: userId }, data: { designationId: functionalRoleId } });

  // Obsolete the user's prior assigned JD, then auto-assign the approved master.
  await prisma.jobDescription.updateMany({
    where: { userId, isDeleted: false, status: { not: 'OBSOLETE' } },
    data: { status: 'OBSOLETE' },
  });

  // Item 2: a freshly assigned JD is a new controlled document → v1. The prior JD is
  // preserved as history above; the version advances only on later revisions (updateJD).
  auditContext.setActionOverride('CREATE');
  const jd = await prisma.jobDescription.create({
    data: {
      userId,
      departmentId: template.departmentId ?? user.departmentId,
      functionalRoleId,
      sourceTemplateId: template.id,
      title: template.title,
      content: DOMPurify.sanitize(template.content),
      version: 1,
      status: 'APPROVED',
      approvedBy: req.user!.id,
      approvedAt: new Date(),
      assignedBy: req.user!.id,
      assignedAt: new Date(),
      createdBy: req.user!.id,
    },
  });
  await notifyJdDecision(userId, jd.title, 'assigned — please acknowledge');
  return jd;
}

/**
 * CR-50 / D-JD3: the JD's owner acknowledges it with the exact sentence plus a
 * secondary-password electronic signature. Records acknowledgedAt + the typed text
 * + the signature, and writes an ACKNOWLEDGE audit row.
 */
export async function acknowledgeJD(jdId: string, input: AcknowledgeJDInput, req: Request) {
  const jd = await getJD(jdId);
  if (jd.userId !== req.user!.id) throw AppError.forbidden('You can only respond to your own Job Description.');
  if (jd.acknowledgedAt) throw AppError.conflict('This Job Description has already been acknowledged.');
  // JD-2: only a live JD awaiting a response may be acknowledged/returned. A JD already
  // returned (REJECTED) or superseded (OBSOLETE) is locked — this prevents an employee
  // from re-acknowledging a JD they just rejected (a contradictory REJECTED+acknowledged
  // state) or acting on an obsolete version.
  if (jd.status !== 'APPROVED') {
    throw AppError.conflict('This Job Description is not awaiting your acknowledgement.');
  }

  const decision = input.decision ?? 'APPROVE';
  const comment = (input.comment ?? '').trim();
  const assignerId = jd.assignedBy ?? jd.approvedBy ?? jd.createdBy;

  // REJECT: the owner sends the JD back to the assigner with a required comment.
  if (decision === 'REJECT') {
    if (!comment) throw AppError.badRequest('Please add a comment explaining why you are rejecting the Job Description.');
    const signatureId = await signFromRequest(req, 'JobDescription', jdId, 'Rejected');
    auditContext.setActionOverride('REJECT');
    const updated = await prisma.jobDescription.update({
      where: { id: jdId },
      data: { status: 'REJECTED', acknowledgementComment: comment, signatureId },
    });
    if (assignerId) await notifyJdDecision(assignerId, jd.title, `returned by the assignee — "${comment}"`);
    return updated;
  }

  // APPROVE: the owner ticks the acknowledgement sentence.
  if ((input.acknowledgementText ?? '').trim() !== JD_ACK_SENTENCE) {
    throw AppError.badRequest('Please tick the acknowledgement statement before submitting.');
  }
  const signatureId = await signFromRequest(req, 'JobDescription', jdId, 'Acknowledged');
  auditContext.setActionOverride('ACKNOWLEDGE');
  return prisma.jobDescription.update({
    where: { id: jdId },
    data: {
      acknowledgedAt: new Date(),
      acknowledgementText: (input.acknowledgementText ?? '').trim(),
      acknowledgementComment: comment || null,
      acknowledgementSignatureId: signatureId,
    },
  });
}

/**
 * Publish the next version of a live (assigned) JD: obsolete the current version so it
 * is preserved in the employee's version history, then create its successor linked via
 * `parentJdId`, left AWAITING acknowledgement (acknowledgedAt stays null). Shared by the
 * per-employee edit (updateJD) and the template-update fan-out (propagateTemplateUpdate).
 */
async function publishJdRevision(
  current: {
    id: string;
    userId: string;
    departmentId: string;
    roleId: string | null;
    functionalRoleId: string | null;
    sourceTemplateId: string | null;
    version: number | null;
    title: string;
    content: string;
  },
  changes: { title?: string; content?: string; departmentId?: string; functionalRoleId?: string | null; sourceTemplateId?: string | null },
  actorId: string,
) {
  // Preserve the current version as history (obsolete → hidden from "My JD").
  auditContext.setActionOverride('UPDATE');
  await prisma.jobDescription.update({ where: { id: current.id }, data: { status: 'OBSOLETE' } });

  // Publish the successor: assigned, awaiting (re-)acknowledgement.
  auditContext.setActionOverride('CREATE');
  return prisma.jobDescription.create({
    data: {
      userId: current.userId,
      departmentId: changes.departmentId ?? current.departmentId,
      roleId: current.roleId,
      functionalRoleId: changes.functionalRoleId !== undefined ? changes.functionalRoleId : current.functionalRoleId,
      sourceTemplateId: changes.sourceTemplateId !== undefined ? changes.sourceTemplateId : current.sourceTemplateId,
      title: changes.title ?? current.title,
      content: changes.content !== undefined ? DOMPurify.sanitize(changes.content) : current.content,
      version: (current.version ?? 1) + 1,
      status: 'APPROVED',
      approvedBy: actorId,
      approvedAt: new Date(),
      assignedBy: actorId,
      assignedAt: new Date(),
      parentJdId: current.id,
      createdBy: actorId,
    },
  });
}

/**
 * Course-style fan-out: propagate a JD template edit to every employee who currently
 * holds a live JD assigned from that template. Each such JD is republished as a new
 * version carrying the template's new title/content, and the employee must acknowledge
 * the update again. Best-effort per employee (one failure never aborts the rest).
 * Returns the number of employees the update was pushed to.
 */
async function propagateTemplateUpdate(
  template: { id: string; functionalRoleId: string | null; departmentId: string | null; title: string; content: string },
  actorId: string,
): Promise<number> {
  // Fetch candidates broadly, then decide in JS which to fan out to. This avoids a
  // Prisma+MongoDB gotcha: a `sourceTemplateId: null` filter does NOT match documents
  // where the field is ABSENT (every JD assigned before this field existed), so the
  // legacy fallback silently matched nobody. Filtering in code sidesteps that entirely.
  const or: Prisma.JobDescriptionWhereInput[] = [{ sourceTemplateId: template.id }];
  if (template.functionalRoleId) {
    // Legacy fallback: JDs assigned before source-template tracking — match by
    // functional role (+ department when the template is department-scoped).
    or.push({
      functionalRoleId: template.functionalRoleId,
      ...(template.departmentId ? { departmentId: template.departmentId } : {}),
    });
  }
  const candidates = await prisma.jobDescription.findMany({ where: { isDeleted: false, status: 'APPROVED', OR: or } });
  // A JD is a fan-out target when it was assigned from THIS template, or (legacy) it has
  // no source template recorded and matches this template's functional role + department.
  const jds = candidates.filter(
    (jd) =>
      jd.sourceTemplateId === template.id ||
      (jd.sourceTemplateId == null &&
        !!template.functionalRoleId &&
        jd.functionalRoleId === template.functionalRoleId &&
        (!template.departmentId || jd.departmentId === template.departmentId)),
  );
  let count = 0;
  for (const jd of jds) {
    try {
      const next = await publishJdRevision(
        jd,
        { title: template.title, content: template.content, functionalRoleId: template.functionalRoleId, sourceTemplateId: template.id },
        actorId,
      );
      await notifyJdDecision(jd.userId, next.title, `updated to v${next.version} — please acknowledge`).catch(() => undefined);
      count++;
    } catch {
      /* skip this employee, continue the fan-out */
    }
  }
  return count;
}

/**
 * Edit a job description. The route requires a reason for change and the edit is
 * e-signed. Obsolete JDs are part of the permanent record and stay locked.
 *
 * Item 2 — the JD version is a true revision lineage tied to edits, exactly like the
 * course/topic model:
 *  - Editing a JD that is LIVE with the employee (status APPROVED — i.e. already
 *    assigned, whether or not it has been acknowledged yet) publishes a NEW version.
 *    The current copy is preserved (obsoleted, so it stays in the employee's version
 *    history), a fresh version is created and linked via `parentJdId`, the version
 *    number advances (v1 → v2 → …), the new version is left AWAITING ACKNOWLEDGEMENT
 *    (acknowledgedAt stays null), and the employee is notified to acknowledge it again.
 *    "My Job Description" always shows the latest non-obsolete version; older versions
 *    live in Version History.
 *  - Editing a JD still being authored (DRAFT / UNDER_REVIEW / REJECTED-in-review —
 *    never assigned to the employee) edits the same row in place; the version number
 *    does not advance.
 */
export async function updateJD(id: string, input: UpdateJDInput, req: Request) {
  const jd = await getJD(id);
  if (jd.status === 'OBSOLETE') {
    throw AppError.conflict('An obsolete job description cannot be edited.');
  }
  // "Ask approval before change" — every JD edit is a controlled, e-signed action.
  await signFromRequest(req, 'JobDescription', id, 'Approved');

  // Versioned revision: the JD is live with the employee, so any change must be
  // (re-)acknowledged. Fires for an APPROVED (assigned) JD whether or not it was already
  // acknowledged, AND for a JD the employee RETURNED (status REJECTED but assigned) — so
  // JD-1: editing a rejected JD re-publishes a fresh version and re-sends it, giving the
  // assigner a real recovery path instead of a permanently stranded row.
  if (jd.status === 'APPROVED' || (jd.status === 'REJECTED' && !!jd.assignedAt)) {
    const next = await publishJdRevision(
      jd,
      { title: input.title, content: input.content, departmentId: input.departmentId, functionalRoleId: input.functionalRoleId },
      req.user!.id,
    );
    await notifyJdDecision(jd.userId, next.title, `revised to v${next.version} — please acknowledge`);
    return next;
  }

  // Authoring edit (never assigned): edit in place, version unchanged.
  auditContext.setActionOverride('UPDATE');
  return prisma.jobDescription.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: DOMPurify.sanitize(input.content) } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.functionalRoleId !== undefined ? { functionalRoleId: input.functionalRoleId } : {}),
    },
  });
}

/**
 * Move a JD through its lifecycle. APPROVE / REJECT require a two-component
 * electronic signature; all decisions notify the affected employee.
 */
export async function transitionJD(id: string, input: JDTransitionInput, req: Request) {
  const jd = await getJD(id);

  switch (input.action) {
    case 'SUBMIT_FOR_REVIEW': {
      if (jd.status !== 'DRAFT') {
        throw AppError.conflict('Only a draft job description can be submitted for review.');
      }
      const updated = await prisma.jobDescription.update({
        where: { id },
        data: { status: 'UNDER_REVIEW' },
      });
      await notifyJdPendingApproval(jd.departmentId, jd.title);
      return updated;
    }

    case 'APPROVE': {
      // CR-48: approving is an approve-verb action, not a generic write.
      if (!hasPermission(req.user!.permissions, 'jobDescription', 'approve')) {
        throw AppError.forbidden('You do not have "approve" permission on jobDescription.');
      }
      if (jd.status !== 'UNDER_REVIEW') {
        throw AppError.conflict('Only a job description under review can be approved.');
      }
      const signatureId = await signFromRequest(req, 'JobDescription', id, 'Approved');
      auditContext.setActionOverride('APPROVE');
      const updated = await prisma.jobDescription.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy: req.user!.id,
          approvedAt: new Date(),
          signatureId,
        },
      });
      await notifyJdDecision(jd.userId, jd.title, 'approved');
      return updated;
    }

    case 'REJECT': {
      // CR-48: rejecting is an approve-verb action, not a generic write.
      if (!hasPermission(req.user!.permissions, 'jobDescription', 'approve')) {
        throw AppError.forbidden('You do not have "approve" permission on jobDescription.');
      }
      if (jd.status !== 'UNDER_REVIEW') {
        throw AppError.conflict('Only a job description under review can be rejected.');
      }
      const signatureId = await signFromRequest(req, 'JobDescription', id, 'Rejected');
      auditContext.setActionOverride('REJECT');
      const updated = await prisma.jobDescription.update({
        where: { id },
        data: { status: 'REJECTED', signatureId },
      });
      await notifyJdDecision(jd.userId, jd.title, 'rejected');
      return updated;
    }

    case 'OBSOLETE': {
      // I1: deactivating (obsoleting) a JD is a controlled action requiring a
      // two-component electronic signature.
      const signatureId = await signFromRequest(req, 'JobDescription', id, 'Approved');
      auditContext.setActionOverride('UPDATE');
      const updated = await prisma.jobDescription.update({ where: { id }, data: { status: 'OBSOLETE', signatureId } });
      await notifyJdDecision(jd.userId, jd.title, 'deactivated');
      return updated;
    }

    case 'REACTIVATE': {
      // Restore a deactivated (obsolete) JD back to active/assigned — controlled, e-signed.
      if (jd.status !== 'OBSOLETE') {
        throw AppError.conflict('Only a deactivated job description can be reactivated.');
      }
      const signatureId = await signFromRequest(req, 'JobDescription', id, 'Approved');
      auditContext.setActionOverride('UPDATE');
      const updated = await prisma.jobDescription.update({ where: { id }, data: { status: 'APPROVED', signatureId } });
      await notifyJdDecision(jd.userId, jd.title, 'reactivated');
      return updated;
    }

    default:
      throw AppError.badRequest('Unsupported job-description transition.');
  }
}

/**
 * Pre-fill a new DRAFT job description from the master template for the
 * employee's department + role (used when an employee is transferred).
 */
export async function createFromTemplate(
  userId: string,
  departmentId: string,
  _roleId: string,
  createdBy: string,
) {
  // D-JD1: templates are keyed by Functional Role (the user's designationId), not RBAC role.
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  const functionalRoleId = user?.designationId ?? null;
  if (!functionalRoleId) throw AppError.notFound('No functional role is set for this user.');
  const templates = await prisma.jDTemplate.findMany({ where: { functionalRoleId, isDeleted: false, isActive: true } });
  const template = templates.find((t) => t.departmentId === departmentId) ?? templates.find((t) => !t.departmentId) ?? templates[0];
  if (!template) throw AppError.notFound('No job-description template found for this functional role.');

  return prisma.jobDescription.create({
    data: {
      userId,
      departmentId,
      functionalRoleId,
      sourceTemplateId: template.id,
      title: template.title,
      content: DOMPurify.sanitize(template.content),
      version: 1,
      status: 'DRAFT',
      createdBy,
    },
  });
}

/**
 * A user's JD version history (never filtered by isDeleted — permanent record).
 * With `onlyPrevious`, returns just the SUPERSEDED (obsolete) versions: the current
 * live version is shown in "My Job Description", so it must not also appear in the
 * Version History list (which should contain only prior versions).
 */
export async function getEmployeeJDHistory(userId: string, opts?: { onlyPrevious?: boolean }) {
  const jds = await prisma.jobDescription.findMany({
    where: { userId, ...(opts?.onlyPrevious ? { status: 'OBSOLETE' } : {}) },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });
  // Enrich so a JD printed from Version History carries the same employee / department /
  // functional-role / approver details as one printed from "My Job Description".
  return enrichJdsForDisplay(jds);
}

// ---- JD templates -----------------------------------------------------------

export async function listTemplates(q: PaginationQuery) {
  const where: Prisma.JDTemplateWhereInput = {
    isDeleted: false,
    ...(q.includeInactive ? {} : { isActive: true }),
    ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.jDTemplate.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.jDTemplate.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function createTemplate(input: JDTemplateInput, createdBy: string) {
  return prisma.jDTemplate.create({
    data: {
      functionalRoleId: input.functionalRoleId,
      departmentId: input.departmentId ?? null,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
      createdBy,
    },
  });
}

/**
 * CR-JD6: editing a master template is a controlled action — it requires a
 * two-component electronic signature plus a reason for change, and records an
 * explicit UPDATE audit action.
 */
export async function updateTemplate(id: string, input: JDTemplateInput, req: Request) {
  const template = await prisma.jDTemplate.findFirst({ where: { id, isDeleted: false } });
  if (!template) throw AppError.notFound('Job-description template not found');
  await signFromRequest(req, 'JDTemplate', id, 'Approved');
  auditContext.setActionOverride('UPDATE');
  const updated = await prisma.jDTemplate.update({
    where: { id },
    data: {
      functionalRoleId: input.functionalRoleId,
      departmentId: input.departmentId ?? null,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
    },
  });

  // Course-style fan-out: push the revised master to every employee holding a JD
  // assigned from this template — each gets a new version to acknowledge again.
  const propagatedCount = await propagateTemplateUpdate(updated, req.user!.id);
  return { ...updated, propagatedCount };
}
