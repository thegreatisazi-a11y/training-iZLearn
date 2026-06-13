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
  return { data, total, page: q.page, pageSize: q.pageSize };
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

/** Edits are only allowed while a JD is still DRAFT or REJECTED. */
export async function updateJD(id: string, input: UpdateJDInput) {
  const jd = await getJD(id);
  if (jd.status !== 'DRAFT' && jd.status !== 'REJECTED') {
    throw AppError.conflict('Only draft or rejected job descriptions can be edited.');
  }
  return prisma.jobDescription.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: DOMPurify.sanitize(input.content) } : {}),
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
      return prisma.jobDescription.update({ where: { id }, data: { status: 'OBSOLETE' } });
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

export async function updateTemplate(id: string, input: JDTemplateInput) {
  const template = await prisma.jDTemplate.findFirst({ where: { id, isDeleted: false } });
  if (!template) throw AppError.notFound('Job-description template not found');
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
