import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
import { notifyTrainingAssigned } from './notification.service';
import type {
  CreateTNIInput,
  TNIDecisionInput,
  SetTniRequirementInput,
  ApplyTniMatrixInput,
  PaginationQuery,
} from '@izlearn/shared';

export async function listTNI(q: PaginationQuery & { userId?: string; status?: string }) {
  const where: Prisma.TNIWhereInput = {
    isDeleted: false,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.status ? { status: q.status as Prisma.EnumTNIStatusFilter['equals'] } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.tNI.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.tNI.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getTNI(id: string) {
  const tni = await prisma.tNI.findFirst({ where: { id, isDeleted: false } });
  if (!tni) throw AppError.notFound('TNI not found');
  return tni;
}

export async function createTNI(input: CreateTNIInput, identifiedBy: string) {
  return prisma.tNI.create({
    data: {
      userId: input.userId,
      topicId: input.topicId,
      identifiedBy,
      justification: input.justification,
      status: 'PENDING',
      createdBy: identifiedBy,
    },
  });
}

/**
 * Approve/reject a TNI. APPROVE is e-signed and atomically activates a
 * TNI_BASED training assignment (the mandatory TNI → Assignment workflow).
 */
export async function decideTNI(id: string, input: TNIDecisionInput, req: Request) {
  const tni = await getTNI(id);
  if (tni.status !== 'PENDING') throw AppError.conflict('This TNI has already been decided.');

  const signatureId = await signFromRequest(req, 'TNI', id, input.decision === 'APPROVE' ? 'Approved' : 'Rejected');
  auditContext.setActionOverride(input.decision === 'APPROVE' ? 'APPROVE' : 'REJECT');

  if (input.decision === 'APPROVE') {
    const { updated } = await auditedTransaction(prisma, async (tx) => {
      const updatedTni = await tx.tNI.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: req.user!.id, approvedAt: new Date(), signatureId },
      });
      const assignment = await tx.trainingAssignment.create({
        data: {
          userId: tni.userId,
          topicId: tni.topicId,
          assignmentType: 'TNI_BASED',
          tniId: id,
          dueDate: input.dueDate ?? null,
          assignedBy: req.user!.id,
          status: 'PENDING',
          createdBy: req.user!.id,
        },
      });
      return {
        result: { updated: updatedTni, assignment },
        audits: [
          { action: 'APPROVE', entityType: 'TNI', entityId: id },
          { action: 'CREATE', entityType: 'TrainingAssignment', entityId: assignment.id, newValue: { tniId: id } },
        ],
      };
    });
    await notifyTrainingAssigned(tni.userId, tni.topicId, input.dueDate ?? null);
    return updated;
  }

  return prisma.tNI.update({
    where: { id },
    data: { status: 'REJECTED', approvedBy: req.user!.id, approvedAt: new Date(), signatureId },
  });
}

// ---- TNI requirement matrix (CR-46 / CR-47 / CR-49) -------------------------

/**
 * The role × topic requirement matrix: active roles, the PUBLISHED topic
 * catalogue, and the saved Required / Not-Required cells. Drives role-based
 * auto-assignment — the primary assignment workflow now that bundles are
 * deprioritized.
 */
export async function getRequirementMatrix() {
  const [roles, topics, cells] = await Promise.all([
    prisma.role.findMany({ where: { isDeleted: false, isActive: true }, select: { id: true, roleName: true } }),
    prisma.trainingTopic.findMany({
      where: { isDeleted: false, status: 'PUBLISHED' },
      select: { id: true, title: true, topicCode: true, topicNumber: true, trainingType: true },
      orderBy: [{ sequenceIndex: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.tniRequirement.findMany({ where: { isDeleted: false } }),
  ]);
  return {
    roles,
    topics,
    cells: cells.map((c) => ({ roleId: c.roleId, topicId: c.topicId, isRequired: c.isRequired, note: c.note })),
  };
}

/** Upsert one matrix cell (role × topic). */
export async function setRequirement(input: SetTniRequirementInput, createdBy: string) {
  const existing = await prisma.tniRequirement.findFirst({ where: { roleId: input.roleId, topicId: input.topicId } });
  if (existing) {
    return prisma.tniRequirement.update({
      where: { id: existing.id },
      data: { isRequired: input.isRequired, note: input.note ?? null, isDeleted: false },
    });
  }
  return prisma.tniRequirement.create({
    data: { roleId: input.roleId, topicId: input.topicId, isRequired: input.isRequired, note: input.note ?? null, createdBy },
  });
}

/**
 * CR-49: materialise training assignments from the Required cells of the matrix.
 * For each Required (role, topic) cell, every active holder of that role gets a
 * ROLE_SPECIFIC assignment for the (PUBLISHED) topic — skipping anyone who already
 * has an active/completed assignment for it. Optionally scoped to a single role.
 */
export async function applyRequirementMatrix(input: ApplyTniMatrixInput, req: Request) {
  const assignedBy = req.user!.id;
  // Bulk assignment is a controlled action — two-component e-signature.
  await signFromRequest(req, 'TniRequirement', input.roleId ?? 'all', 'Approved');
  const cells = await prisma.tniRequirement.findMany({
    where: { isDeleted: false, isRequired: true, ...(input.roleId ? { roleId: input.roleId } : {}) },
  });
  if (!cells.length) return { created: 0 };

  const topicIds = Array.from(new Set(cells.map((c) => c.topicId)));
  const publishable = new Set(
    (await prisma.trainingTopic.findMany({ where: { id: { in: topicIds }, isDeleted: false, status: 'PUBLISHED' }, select: { id: true } })).map((t) => t.id),
  );

  // CR-57: assign-later keeps matrix assignments DEFERRED until activated.
  const deferred = !!input.activateLater;
  let created = 0;
  for (const cell of cells) {
    if (!publishable.has(cell.topicId)) continue;
    const holders = await prisma.userRole.findMany({ where: { roleId: cell.roleId, isActive: true } });
    for (const h of holders) {
      const exists = await prisma.trainingAssignment.findFirst({
        where: { userId: h.userId, topicId: cell.topicId, isDeleted: false, status: { notIn: ['WAIVED'] } },
      });
      if (exists) continue;
      const a = await prisma.trainingAssignment.create({
        data: {
          userId: h.userId,
          topicId: cell.topicId,
          assignmentType: 'ROLE_SPECIFIC',
          dueDate: input.dueDate ?? null,
          activateOn: deferred ? input.activateOn ?? null : null,
          assignedBy,
          status: deferred ? 'DEFERRED' : 'PENDING',
          createdBy: assignedBy,
        },
      });
      created++;
      if (!deferred) await notifyTrainingAssigned(a.userId, a.topicId, a.dueDate);
    }
  }
  return { created };
}
