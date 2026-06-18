import { Request } from 'express';
import { Prisma } from '@prisma/client';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { hasPermission } from '../utils/permissions';
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

export async function listJDs(q: PaginationQuery & { userId?: string }) {
  const where: Prisma.JobDescriptionWhereInput = {
    isDeleted: false,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
  };
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
 * B1: every non-obsolete JD assigned to the logged-in user (supports holding more
 * than one active JD), newest first, with the assigning supervisor's name resolved.
 */
export async function listMyJDs(userId: string) {
  const jds = await prisma.jobDescription.findMany({
    where: { userId, isDeleted: false, status: { not: 'OBSOLETE' } },
    orderBy: [{ assignedAt: 'desc' }, { version: 'desc' }, { createdAt: 'desc' }],
  });
  const assignerIds = Array.from(new Set(jds.map((j) => j.assignedBy).filter(Boolean) as string[]));
  const people = assignerIds.length
    ? await prisma.user.findMany({ where: { id: { in: assignerIds } }, select: { id: true, fullName: true } })
    : [];
  const nameById = new Map(people.map((u) => [u.id, u.fullName]));
  return jds.map((j) => ({ ...j, assignedByName: j.assignedBy ? nameById.get(j.assignedBy) ?? null : null }));
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
  const template = await prisma.jDTemplate.findFirst({ where: { id: input.templateId, isDeleted: false } });
  if (!template) throw AppError.notFound('Job-description template not found');

  // Controlled, direct assignment — two-component e-signature.
  await signFromRequest(req, 'User', input.userId, 'Approved');

  const last = await prisma.jobDescription.findFirst({ where: { userId: input.userId }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;

  auditContext.setActionOverride('CREATE');
  const jd = await prisma.jobDescription.create({
    data: {
      userId: input.userId,
      departmentId: input.departmentId ?? template.departmentId ?? user.departmentId,
      functionalRoleId: template.functionalRoleId,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
      version,
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
  const last = await prisma.jobDescription.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;

  auditContext.setActionOverride('CREATE');
  const jd = await prisma.jobDescription.create({
    data: {
      userId,
      departmentId: template.departmentId ?? user.departmentId,
      functionalRoleId,
      title: template.title,
      content: DOMPurify.sanitize(template.content),
      version,
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
  if (jd.userId !== req.user!.id) throw AppError.forbidden('You can only acknowledge your own Job Description.');
  if (jd.acknowledgedAt) throw AppError.conflict('This Job Description has already been acknowledged.');
  if (input.acknowledgementText.trim() !== JD_ACK_SENTENCE) {
    throw AppError.badRequest(`Please type the acknowledgement exactly: "${JD_ACK_SENTENCE}"`);
  }
  const signatureId = await signFromRequest(req, 'JobDescription', jdId, 'Acknowledged');
  auditContext.setActionOverride('ACKNOWLEDGE');
  return prisma.jobDescription.update({
    where: { id: jdId },
    data: {
      acknowledgedAt: new Date(),
      acknowledgementText: input.acknowledgementText.trim(),
      acknowledgementSignatureId: signatureId,
    },
  });
}

/**
 * Edits are allowed while a JD is DRAFT or REJECTED, and — I2 — on an APPROVED
 * assigned JD (a controlled edit: the route requires a reason for change, which the
 * audit middleware records). Obsolete JDs are part of the permanent record and stay
 * locked. Editing an already-acknowledged JD clears the acknowledgement so the user
 * must re-acknowledge the revised responsibilities.
 */
export async function updateJD(id: string, input: UpdateJDInput) {
  const jd = await getJD(id);
  if (jd.status === 'OBSOLETE') {
    throw AppError.conflict('An obsolete job description cannot be edited.');
  }
  const reAcknowledge = jd.status === 'APPROVED' && !!jd.acknowledgedAt;
  return prisma.jobDescription.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: DOMPurify.sanitize(input.content) } : {}),
      ...(reAcknowledge ? { acknowledgedAt: null, acknowledgementText: null, acknowledgementSignatureId: null } : {}),
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
      title: template.title,
      content: DOMPurify.sanitize(template.content),
      version: 1,
      status: 'DRAFT',
      createdBy,
    },
  });
}

/** Full JD history for an employee (never filtered by isDeleted — permanent record). */
export async function getEmployeeJDHistory(userId: string) {
  return prisma.jobDescription.findMany({
    where: { userId },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });
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
  return prisma.jDTemplate.update({
    where: { id },
    data: {
      functionalRoleId: input.functionalRoleId,
      departmentId: input.departmentId ?? null,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
    },
  });
}
