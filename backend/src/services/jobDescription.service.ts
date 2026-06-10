import { Request } from 'express';
import { Prisma } from '@prisma/client';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
import { notifyJdPendingApproval, notifyJdDecision } from './notification.service';
import type {
  CreateJDInput,
  UpdateJDInput,
  JDTransitionInput,
  JDTemplateInput,
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
  roleId: string,
  createdBy: string,
) {
  const template = await prisma.jDTemplate.findFirst({
    where: { departmentId, roleId, isDeleted: false, isActive: true },
  });
  if (!template) throw AppError.notFound('No job-description template found for this department and role.');

  return prisma.jobDescription.create({
    data: {
      userId,
      departmentId,
      roleId,
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
      departmentId: input.departmentId,
      roleId: input.roleId,
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
      departmentId: input.departmentId,
      roleId: input.roleId,
      title: input.title,
      content: DOMPurify.sanitize(input.content),
    },
  });
}
