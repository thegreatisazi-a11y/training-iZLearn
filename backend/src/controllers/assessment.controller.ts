import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, AppError } from '../utils/response';
import * as svc from '../services/assessment.service';

export const start = asyncHandler(async (req: Request, res: Response) =>
  sendCreated(res, await svc.startAttempt(req.user!.id, req.body.topicId, req.body.assignmentId), 'Assessment started'),
);

export const submit = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.submitAttempt(req.body.attemptId, req.body.answers, req.user!.id, req.body.autoSubmitted === true, req.body.reason), 'Assessment submitted'),
);

export const acknowledgeRead = asyncHandler(async (req: Request, res: Response) =>
  sendCreated(res, await svc.completeByAcknowledgement(req.user!.id, req.body.topicId, req.body.assignmentId), 'Training completed'),
);

export const listMine = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.listAttempts({ userId: req.user!.id, topicId: req.query.topicId as string | undefined })),
);

export const list = asyncHandler(async (req, res) => {
  // ASMT-2: this endpoint must not expose arbitrary users' attempts. Resolve the
  // requester's scope and restrict the userId filter to what they may see.
  const scope = await svc.attemptViewerScope({
    id: req.user!.id,
    roleNames: req.user!.roleNames,
    permissions: req.user!.permissions as Record<string, Record<string, boolean>>,
  });
  const userId = req.query.userId as string | undefined;
  if (!scope.canSeeAll) {
    const allowed = new Set([req.user!.id, ...scope.teamUserIds]);
    if (!userId || !allowed.has(userId)) {
      throw AppError.forbidden('You may only view assessments for yourself or your direct reports.');
    }
  }
  sendSuccess(res, await svc.listAttempts({ userId, topicId: req.query.topicId as string | undefined }));
});

// Item 3: completed attempts of OTHER users the requester may view/download — scoped to
// their team (supervisor) or the whole org (admin / training coordinator / SUPER_ADMIN).
export const listManaged = asyncHandler(async (req, res) =>
  sendSuccess(
    res,
    await svc.listManagedAttempts(
      { id: req.user!.id, roleNames: req.user!.roleNames, permissions: req.user!.permissions as Record<string, Record<string, boolean>> },
      { userId: req.query.userId as string | undefined, topicId: req.query.topicId as string | undefined },
    ),
  ),
);

// ASMT-2: the raw attempt exposes the answer key (questionsUsed.correctAnswer) and has
// no ownership check. Route it through the SAME scoped, answer-key-hidden review the
// /:id/review endpoint uses — an owner or a manager in scope only.
export const get = asyncHandler(async (req, res) => {
  const scope = await svc.attemptViewerScope({
    id: req.user!.id,
    roleNames: req.user!.roleNames,
    permissions: req.user!.permissions as Record<string, Record<string, boolean>>,
  });
  sendSuccess(res, await svc.reviewAttempt(req.params.id, req.user!.id, scope));
});

// View a completed attempt's full review (questions + answers) — the learner's own, or
// any attempt for a manager with assessments:write.
export const review = asyncHandler(async (req, res) => {
  // Item 3: own attempt (any user), a supervisor's direct report, or org-wide for
  // admin / training coordinator. Scope is resolved from the requester's roles/perms.
  const scope = await svc.attemptViewerScope({
    id: req.user!.id,
    roleNames: req.user!.roleNames,
    permissions: req.user!.permissions as Record<string, Record<string, boolean>>,
  });
  sendSuccess(res, await svc.reviewAttempt(req.params.id, req.user!.id, scope));
});

export const unblock = asyncHandler(async (req, res) =>
  sendSuccess(res, await svc.unblockAssignment(req.params.assignmentId, req), 'Assignment unblocked'),
);
