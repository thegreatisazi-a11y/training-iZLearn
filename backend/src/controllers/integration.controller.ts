import { Request, Response } from 'express';
import { asyncHandler, AppError } from '../utils/response';

/**
 * System integration points (Section 8). These are documented stubs that return
 * HTTP 501 until the corresponding external system is wired in. The request/
 * response contracts below define the intended integration surface.
 */

// POST /integrations/dms/sync — Document Management System sync.
// Intended: push/pull controlled documents (JDs, SOP-linked materials) to/from
// an external DMS (e.g. Veeva/OpenText) and reconcile version/approval state.
export const dmsSync = asyncHandler(async (_req: Request, _res: Response) => {
  throw AppError.notImplemented('DMS sync is not implemented. Wire in your Document Management System adapter here.');
});

// POST /integrations/hr/user-sync — HR system user data sync.
// Intended: import joiners/leavers/transfers from the HRIS to drive user
// lifecycle and JD-on-transfer pre-fill.
export const hrUserSync = asyncHandler(async (_req: Request, _res: Response) => {
  throw AppError.notImplemented('HR user sync is not implemented. Wire in your HRIS adapter here.');
});

// POST /integrations/instrument/training-trigger — Instrument qualification trigger.
// Intended: when an instrument is (re)qualified, auto-create the relevant
// operator training assignments.
export const instrumentTrainingTrigger = asyncHandler(async (_req: Request, _res: Response) => {
  throw AppError.notImplemented('Instrument training trigger is not implemented. Wire in your instrument/LIMS adapter here.');
});
