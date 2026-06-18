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
  const [rows, total] = await Promise.all([
    prisma.tNI.findMany({ where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.tNI.count({ where }),
  ]);
  // J2: resolve user + topic ids → names so the Requests list shows the user and topic.
  const userIds = Array.from(new Set(rows.map((r) => r.userId).filter(Boolean)));
  const topicIds = Array.from(new Set(rows.map((r) => r.topicId).filter(Boolean)));
  const [users, topics] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
    topicIds.length ? prisma.trainingTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const topicTitle = new Map(topics.map((t) => [t.id, t.title]));
  const data = rows.map((r) => ({
    ...r,
    userFullName: userName.get(r.userId) ?? null,
    topicTitle: topicTitle.get(r.topicId) ?? null,
  }));
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getTNI(id: string) {
  const tni = await prisma.tNI.findFirst({ where: { id, isDeleted: false } });
  if (!tni) throw AppError.notFound('TNI not found');
  return tni;
}

/**
 * J2: create a TNI for one user across one or more topics — stored as one TNI row
 * per (user, topic). Topics that already have an open (PENDING/APPROVED) TNI for the
 * user are skipped so the same need is not raised twice.
 */
export async function createTNI(input: CreateTNIInput, identifiedBy: string) {
  const topicIds = Array.from(new Set([...(input.topicIds ?? []), ...(input.topicId ? [input.topicId] : [])]));
  if (!topicIds.length) throw AppError.badRequest('Select at least one topic.');

  const existing = await prisma.tNI.findMany({
    where: { userId: input.userId, topicId: { in: topicIds }, isDeleted: false, status: { in: ['PENDING', 'APPROVED'] } },
    select: { topicId: true },
  });
  const skip = new Set(existing.map((e) => e.topicId));
  const toCreate = topicIds.filter((t) => !skip.has(t));
  if (!toCreate.length) throw AppError.conflict('An open TNI already exists for the selected topic(s).');

  const created = await Promise.all(
    toCreate.map((topicId) =>
      prisma.tNI.create({
        data: {
          userId: input.userId,
          topicId,
          identifiedBy,
          justification: input.justification,
          status: 'PENDING',
          createdBy: identifiedBy,
        },
      }),
    ),
  );
  return { created: created.length, skipped: skip.size, items: created };
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

/** Merge a user's functional roles (primary designationId + designationIds array). */
function userFunctionalRoleIds(u: { designationId?: string | null; designationIds?: unknown }): string[] {
  const arr = Array.isArray(u.designationIds) ? (u.designationIds as string[]) : [];
  const merged = [...arr];
  if (u.designationId && !merged.includes(u.designationId)) merged.push(u.designationId);
  return merged;
}

/**
 * The functional-role × topic requirement matrix: active functional roles
 * (DesignationMaster — e.g. "QA Auditor", "Analyst"), the PUBLISHED topic
 * catalogue, and the saved Required / Not-Required cells. Drives functional-role-
 * based auto-assignment. NOTE: columns are FUNCTIONAL roles (job functions), not
 * RBAC login roles (SUPER_ADMIN / TRAINER / …).
 */
export async function getRequirementMatrix() {
  const [designations, topics, cells] = await Promise.all([
    prisma.designationMaster.findMany({ where: { isDeleted: false, isActive: true }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }),
    prisma.trainingTopic.findMany({
      where: { isDeleted: false, status: 'PUBLISHED' },
      select: { id: true, title: true, topicCode: true, topicNumber: true, trainingType: true },
      orderBy: [{ sequenceIndex: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.tniRequirement.findMany({ where: { isDeleted: false } }),
  ]);
  return {
    designations,
    topics,
    cells: cells.map((c) => ({ designationId: c.designationId, topicId: c.topicId, isRequired: c.isRequired, note: c.note })),
  };
}

/** Upsert one matrix cell (functional role × topic). */
export async function setRequirement(input: SetTniRequirementInput, createdBy: string) {
  const existing = await prisma.tniRequirement.findFirst({ where: { designationId: input.designationId, topicId: input.topicId } });
  if (existing) {
    return prisma.tniRequirement.update({
      where: { id: existing.id },
      data: { isRequired: input.isRequired, note: input.note ?? null, isDeleted: false },
    });
  }
  return prisma.tniRequirement.create({
    data: { designationId: input.designationId, topicId: input.topicId, isRequired: input.isRequired, note: input.note ?? null, createdBy },
  });
}

/**
 * CR-49: materialise training assignments from the Required cells of the matrix.
 * For each Required (functional role, topic) cell, every active user holding that
 * functional role (via designationId / designationIds) gets a ROLE_SPECIFIC
 * assignment for the (PUBLISHED) topic — skipping anyone who already has an
 * active/completed assignment for it. Optionally scoped to a single functional role.
 */
export async function applyRequirementMatrix(input: ApplyTniMatrixInput, req: Request) {
  const assignedBy = req.user!.id;
  // Bulk assignment is a controlled action — two-component e-signature.
  await signFromRequest(req, 'TniRequirement', input.designationId ?? 'all', 'Approved');
  const cells = await prisma.tniRequirement.findMany({
    where: { isDeleted: false, isRequired: true, ...(input.designationId ? { designationId: input.designationId } : {}) },
  });
  if (!cells.length) return { created: 0 };

  const topicIds = Array.from(new Set(cells.map((c) => c.topicId)));
  const publishable = new Set(
    (await prisma.trainingTopic.findMany({ where: { id: { in: topicIds }, isDeleted: false, status: 'PUBLISHED' }, select: { id: true } })).map((t) => t.id),
  );

  // Resolve functional-role holders once: designationId -> Set<userId>. A user may
  // hold several functional roles (primary designationId + designationIds array).
  const activeUsers = await prisma.user.findMany({
    where: { isActive: true, isDeleted: false },
    select: { id: true, designationId: true, designationIds: true },
  });
  const holdersByDesignation = new Map<string, string[]>();
  for (const u of activeUsers) {
    for (const d of userFunctionalRoleIds(u)) {
      const list = holdersByDesignation.get(d) ?? [];
      list.push(u.id);
      holdersByDesignation.set(d, list);
    }
  }

  // CR-57: assign-later keeps matrix assignments DEFERRED until activated.
  const deferred = !!input.activateLater;
  let created = 0;
  for (const cell of cells) {
    if (!publishable.has(cell.topicId)) continue;
    const holderIds = holdersByDesignation.get(cell.designationId) ?? [];
    for (const userId of holderIds) {
      const exists = await prisma.trainingAssignment.findFirst({
        where: { userId, topicId: cell.topicId, isDeleted: false, status: { notIn: ['WAIVED'] } },
      });
      if (exists) continue;
      const a = await prisma.trainingAssignment.create({
        data: {
          userId,
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
