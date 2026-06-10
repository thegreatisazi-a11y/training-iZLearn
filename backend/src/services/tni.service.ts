import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
import { notifyTrainingAssigned } from './notification.service';
import type { CreateTNIInput, TNIDecisionInput, PaginationQuery } from '@izlearn/shared';

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
