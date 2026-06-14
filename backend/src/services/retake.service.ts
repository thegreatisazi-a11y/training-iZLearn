import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditedTransaction } from '../middlewares/auditTrail.middleware';
import { auditContext } from '../utils/auditContext';
import { signFromRequest } from './eSignature.service';
import { notifyRetakeRequested, notifyRetakeDecision } from './notification.service';
import type { CreateRetakeRequestInput, RetakeDecisionInput, PaginationQuery } from '@izlearn/shared';

/**
 * Module: assessment retake requests. A trainee whose assignment is BLOCKED
 * (max attempts exhausted) requests a retake; the request is routed to their
 * direct supervisor. On approval the assignment is unblocked and a fresh set of
 * attempts is granted (extraAttempts), so the effective limit becomes
 * topic.maxAttempts again from the current attempt count.
 */

/** Attach the trainee name + topic title to a set of retake requests for display. */
async function withNames<T extends { userId: string; topicId: string }>(rows: T[]) {
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const topicIds = Array.from(new Set(rows.map((r) => r.topicId)));
  const [users, topics] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, employeeId: true } }) : [],
    topicIds.length ? prisma.trainingTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true, topicNumber: true, topicCode: true } }) : [],
  ]);
  const uName = new Map(users.map((u) => [u.id, u]));
  const tName = new Map(topics.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...r,
    userFullName: uName.get(r.userId)?.fullName ?? r.userId,
    employeeId: uName.get(r.userId)?.employeeId ?? null,
    topicTitle: tName.get(r.topicId)?.title ?? r.topicId,
    topicNumber: tName.get(r.topicId)?.topicNumber ?? tName.get(r.topicId)?.topicCode ?? null,
  }));
}

/** Trainee creates a retake request for one of their BLOCKED assignments. */
export async function createRetakeRequest(input: CreateRetakeRequestInput, userId: string) {
  const assignment = await prisma.trainingAssignment.findFirst({ where: { id: input.assignmentId, isDeleted: false } });
  if (!assignment) throw AppError.notFound('Assignment not found');
  if (assignment.userId !== userId) throw AppError.forbidden('This assignment does not belong to you.');
  if (assignment.status !== 'BLOCKED') {
    throw AppError.badRequest('A retake can only be requested for a blocked assessment (maximum attempts reached).');
  }

  const existing = await prisma.retakeRequest.findFirst({
    where: { assignmentId: input.assignmentId, status: 'PENDING_APPROVAL', isDeleted: false },
  });
  if (existing) throw AppError.conflict('A retake request for this assessment is already pending.');

  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false }, select: { supervisorId: true } });

  const created = await prisma.retakeRequest.create({
    data: {
      userId,
      topicId: assignment.topicId,
      assignmentId: assignment.id,
      supervisorId: user?.supervisorId ?? null,
      justification: input.justification,
      status: 'PENDING_APPROVAL',
      createdBy: userId,
    },
  });

  await notifyRetakeRequested(userId, assignment.topicId, input.justification);
  return created;
}

/** The signed-in trainee's own retake requests (to show status on their trainings). */
export async function listMyRetakeRequests(userId: string) {
  const rows = await prisma.retakeRequest.findMany({ where: { userId, isDeleted: false }, orderBy: { createdAt: 'desc' } });
  return withNames(rows);
}

/**
 * Retake requests routed to the signed-in supervisor (their direct reports).
 * SUPER_ADMIN sees all. Scoped server-side.
 */
export async function listForSupervisor(req: Request, q: PaginationQuery & { status?: string }) {
  const requester = req.user!;
  const seeAll = requester.roleNames.includes('SUPER_ADMIN');
  const where: Prisma.RetakeRequestWhereInput = {
    isDeleted: false,
    ...(seeAll ? {} : { supervisorId: requester.id }),
    ...(q.status ? { status: q.status as Prisma.EnumRetakeRequestStatusFilter['equals'] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.retakeRequest.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.retakeRequest.count({ where }),
  ]);
  return { data: await withNames(rows), total, page: q.page, pageSize: q.pageSize };
}

/**
 * Supervisor decision on a retake request (e-signed). Only the trainee's direct
 * supervisor (or a SUPER_ADMIN) may decide. APPROVE unblocks the assignment and
 * grants a fresh maxAttempts by setting extraAttempts to the attempts used so far.
 */
export async function decideRetakeRequest(id: string, input: RetakeDecisionInput, req: Request) {
  const request = await prisma.retakeRequest.findFirst({ where: { id, isDeleted: false } });
  if (!request) throw AppError.notFound('Retake request not found');
  if (request.status !== 'PENDING_APPROVAL') throw AppError.conflict('This retake request has already been decided.');

  const isSupervisor = request.supervisorId && request.supervisorId === req.user!.id;
  const isSuperAdmin = req.user!.roleNames.includes('SUPER_ADMIN');
  if (!isSupervisor && !isSuperAdmin) {
    throw AppError.forbidden('Only the trainee’s direct supervisor may decide this retake request.');
  }

  const approve = input.decision === 'APPROVE';
  const signatureId = await signFromRequest(req, 'RetakeRequest', id, approve ? 'Approved' : 'Rejected');
  auditContext.setActionOverride(approve ? 'APPROVE' : 'REJECT');

  if (approve) {
    // Grant a fresh maxAttempts: set extraAttempts to the count of attempts already
    // used for this topic, so effectiveMax = maxAttempts + used (the user gets the
    // full limit again from now). Then unblock the assignment.
    const usedAttempts = await prisma.assessmentAttempt.count({ where: { userId: request.userId, topicId: request.topicId, isDeleted: false } });
    const { updated } = await auditedTransaction(prisma, async (tx) => {
      const updatedRequest = await tx.retakeRequest.update({
        where: { id },
        data: { status: 'APPROVED', decidedBy: req.user!.id, decidedAt: new Date(), decisionRemarks: input.decisionRemarks ?? null, signatureId },
      });
      await tx.trainingAssignment.update({
        where: { id: request.assignmentId },
        data: { status: 'PENDING', extraAttempts: usedAttempts },
      });
      return {
        result: { updated: updatedRequest },
        audits: [
          { action: 'APPROVE', entityType: 'RetakeRequest', entityId: id },
          { action: 'UPDATE', entityType: 'TrainingAssignment', entityId: request.assignmentId, newValue: { status: 'PENDING', extraAttempts: usedAttempts, retakeRequestId: id } },
        ],
      };
    });
    await notifyRetakeDecision(request.userId, request.topicId, true, input.decisionRemarks);
    return updated;
  }

  const rejected = await prisma.retakeRequest.update({
    where: { id },
    data: { status: 'REJECTED', decidedBy: req.user!.id, decidedAt: new Date(), decisionRemarks: input.decisionRemarks ?? null, signatureId },
  });
  await notifyRetakeDecision(request.userId, request.topicId, false, input.decisionRemarks);
  return rejected;
}
