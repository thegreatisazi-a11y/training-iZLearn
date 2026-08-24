import { Request, Response } from 'express';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated, AppError } from '../utils/response';
import { paginationQuery, updateMaterialSchema } from '@izlearn/shared';
import { hasPermission } from '../utils/permissions';
import { contentTypeForExt } from '../utils/fileUtils';
import { streamDownload } from '../utils/fileDownload';
import { prisma } from '../config/prisma';
import { getBool } from '../services/systemConfig.service';
import * as svc from '../services/trainingMaterial.service';
import * as viewSvc from '../services/materialView.service';

/**
 * A "material manager" (can see every version) is anyone with write rights on
 * either the material library or course management. Everyone else is treated as
 * a trainee and only sees the current, non-obsolete version (UR-16).
 */
function canManageMaterials(req: Request): boolean {
  return (
    hasPermission(req.user?.permissions, 'materialManagement', 'write') ||
    hasPermission(req.user?.permissions, 'courseManagement', 'write')
  );
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const topicId = typeof req.query.topicId === 'string' ? req.query.topicId : undefined;
  const manager = canManageMaterials(req);
  // Managers viewing a topic also see the archived files of its previous versions
  // (the version lineage), so the Archived Materials section is complete.
  const topicIds = topicId && manager ? await svc.lineageTopicIds(topicId) : undefined;
  const r = await svc.listMaterials({
    ...q,
    topicId: topicIds ? undefined : topicId,
    topicIds,
    fileType: typeof req.query.fileType === 'string' ? req.query.fileType : undefined,
    onlyCurrent: !manager,
  });
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const material = await svc.getMaterial(req.params.id);
  // UR-16: trainees may not read an obsolete / superseded version by its id.
  if (!canManageMaterials(req) && (material.isObsolete || !material.isCurrentVersion)) {
    throw AppError.forbidden('Only the current version of this material is available.');
  }
  sendSuccess(res, material);
});

export const upload = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest('A file is required.');
  const topicId = (req.body?.topicId ?? '').toString();
  if (!topicId) throw AppError.badRequest('topicId is required.');
  const material = await svc.uploadMaterial(topicId, req.file, req.user!.id);
  sendCreated(res, material, 'Material uploaded');
});

/**
 * CR-MAT2: Bulk-upload multiple files (multer .array('files')). topicId is
 * optional — when omitted the files become library-level materials reusable into
 * topics later. Returns an { uploaded, failed, errors[] } summary; partial
 * success is reported with HTTP 200.
 */
export const bulkUpload = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw AppError.badRequest('At least one file is required.');
  const topicId = req.body?.topicId ? req.body.topicId.toString() : undefined;
  const result = await svc.bulkUploadMaterials(files, req.user!.id, { topicId });
  sendSuccess(res, result, `${result.uploaded} file(s) uploaded${result.failed ? `, ${result.failed} failed` : ''}`);
});

// --- Global "training instruction" file (shown before reading on Start Training) ---

/** The current instruction (or null). Available to any authenticated user. */
export const instruction = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await svc.getCurrentInstruction());
});

/** Flag/unflag a library material as the training instruction (managers). */
export const setInstruction = asyncHandler(async (req: Request, res: Response) => {
  const on = req.body?.on !== false; // default: set as instruction
  const updated = await svc.setInstruction(req.params.id, on, req.user!.id);
  sendSuccess(res, updated, on ? 'Set as training instruction' : 'Instruction cleared');
});

/** Update the instruction with a new uploaded file (versioned; managers). */
export const replaceInstruction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest('A file is required.');
  sendCreated(res, await svc.replaceInstruction(req.file, req.user!.id), 'Instruction updated');
});

/** Record that a trainee acknowledged the instruction before starting. */
export const acknowledgeInstruction = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.acknowledgeInstruction(req.user!.id, req.params.id));
});

// /**
 // * Non-manager read access to one material file, shared by the inline viewer and the download
 // * endpoint so the two can never drift apart (they were previously duplicated line-for-line).
 // * No-ops for material/course managers, who may reach any version.
 // */
// async function assertMayReadMaterial(req: Request): Promise<void> {
  // if (canManageMaterials(req)) return;
//
  // const material = await svc.getMaterial(req.params.id);
  // // UR-16: a trainee may only reach the current, non-obsolete version.
  // if (material.isObsolete || !material.isCurrentVersion) {
    // throw AppError.forbidden('Only the current version of this material is available.');
  // }
  // // The global training instruction is a Library file with no parent topic and is shown to
  // // every trainee before starting; exempt it from the topic-published / completion gates
  // // below (which would otherwise 403 since there is no PUBLISHED parent topic to find).
  // if (material.isInstruction) return;
//
  // // Other Material Library files likewise have no parent topic. MAT-1 exists to stop a
  // // trainee reaching UNPUBLISHED TOPIC content by guessing an id — a library file is not
  // // topic content, and the library listing is already gated on materialManagement:read.
  // // Without this, a read-only library user could browse the listing but preview nothing.
  // if (!material.topicId) {
    // if (!hasPermission(req.user?.permissions, 'materialManagement', 'read')) {
      // throw AppError.forbidden('This material is not currently available.');
    // }
    // return;
  // }
//
  // // MAT-1: a trainee may only reach files of a PUBLISHED topic — never draft/under-review
  // // (or archived) content, even by guessing a material id.
  // const parentTopic = await prisma.trainingTopic.findFirst({ where: { id: material.topicId }, select: { status: true } });
  // if (!parentTopic || parentTopic.status !== 'PUBLISHED') {
    // throw AppError.forbidden('This material is not currently available.');
  // }
  // // CR-33: optional workflow lock — once the trainee has COMPLETED this topic's
  // // training, material access is revoked (enable via material.lock_after_completion).
  // if (await getBool('material.lock_after_completion', false)) {
    // const completed = await prisma.trainingAssignment.findFirst({
      // where: { userId: req.user!.id, topicId: material.topicId, isDeleted: false, status: 'COMPLETED' },
    // });
    // if (completed) {
      // throw AppError.forbidden('Access to this material is locked after you have completed the training.');
    // }
  // }
// }
//
export const download = asyncHandler(async (req: Request, res: Response) => {
  // BUG-10: this endpoint serves BOTH the inline locked viewer (no flag) and explicit
  // file downloads (?download=1). View-only users may render inline but must not save
  // the file — only material managers (download permission) can perform a real download.
  const isExplicitDownload = req.query.download === '1';
  if (isExplicitDownload && !canManageMaterials(req)) {
    throw AppError.forbidden('You do not have permission to download this material.');
  }
  // UR-16: a trainee may only download the current, non-obsolete version.
  if (!canManageMaterials(req)) {
    const material = await svc.getMaterial(req.params.id);
    if (material.isObsolete || !material.isCurrentVersion) {
      throw AppError.forbidden('Only the current version of this material is available.');
    }
    // The global training instruction is a Library file with no parent topic and is shown to
    // every trainee before starting; exempt it from the topic-published / completion gates
    // below (which would otherwise 403 since there is no PUBLISHED parent topic to find).
    if (!material.isInstruction) {
      // MAT-1: a trainee may only reach files of a PUBLISHED topic — never draft/under-review
      // (or archived) content, even by guessing a material id.
      const parentTopic = await prisma.trainingTopic.findFirst({ where: { id: material.topicId }, select: { status: true } });
      if (!parentTopic || parentTopic.status !== 'PUBLISHED') {
        throw AppError.forbidden('This material is not currently available.');
      }
      // CR-33: optional workflow lock — once the trainee has COMPLETED this topic's
      // training, material access is revoked (enable via material.lock_after_completion).
      if (await getBool('material.lock_after_completion', false)) {
        const completed = await prisma.trainingAssignment.findFirst({
          where: { userId: req.user!.id, topicId: material.topicId, isDeleted: false, status: 'COMPLETED' },
        });
        if (completed) {
          throw AppError.forbidden('Access to this material is locked after you have completed the training.');
        }
      }
    }
  }
  // await assertMayReadMaterial(req);
  const { key, originalFileName, fileType } = await svc.downloadMaterial(req.params.id);
  await streamDownload(res, key, originalFileName, contentTypeForExt(fileType), { inline: true });
});

/**
 * Locked, view-only PDF rendering for the in-app viewer. Native PDFs stream through;
 * Office documents are converted to PDF (cached) server-side. Enforces the SAME access
 * rules as the inline download (current non-obsolete version only for trainees; the
 * optional lock-after-completion workflow), then streams the PDF inline.
 */
export const viewPdf = asyncHandler(async (req: Request, res: Response) => {
  if (!canManageMaterials(req)) {
    const material = await svc.getMaterial(req.params.id);
    if (material.isObsolete || !material.isCurrentVersion) {
      throw AppError.forbidden('Only the current version of this material is available.');
    }
    // The global training instruction is a Library file with no parent topic and is shown to
    // every trainee before starting; exempt it from the topic-published / completion gates
    // below (which would otherwise 403 since there is no PUBLISHED parent topic to find).
    if (!material.isInstruction) {
      // MAT-1: a trainee may only reach files of a PUBLISHED topic — never draft/under-review
      // (or archived) content, even by guessing a material id.
      const parentTopic = await prisma.trainingTopic.findFirst({ where: { id: material.topicId }, select: { status: true } });
      if (!parentTopic || parentTopic.status !== 'PUBLISHED') {
        throw AppError.forbidden('This material is not currently available.');
      }
      if (await getBool('material.lock_after_completion', false)) {
        const completed = await prisma.trainingAssignment.findFirst({
          where: { userId: req.user!.id, topicId: material.topicId, isDeleted: false, status: 'COMPLETED' },
        });
        if (completed) {
          throw AppError.forbidden('Access to this material is locked after you have completed the training.');
        }
      }
    }
  }
  // await assertMayReadMaterial(req);
  const { key, originalFileName } = await svc.getViewablePdf(req.params.id);
  const pdfName = `${originalFileName.replace(/\.[^.]+$/, '')}.pdf`;
  await streamDownload(res, key, pdfName, 'application/pdf', { inline: true });
});

export const replace = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw AppError.badRequest('A replacement file is required.');
  const material = await svc.replaceMaterial(req.params.id, req.file, req.user!.id);
  sendCreated(res, material, 'Material replaced with a new version');
});

/** 4.1 (library variant): replace a specific material with a Material Library file. */
export const replaceFromLibrary = asyncHandler(async (req: Request, res: Response) => {
  const sourceMaterialId = (req.body?.sourceMaterialId ?? '').toString();
  if (!sourceMaterialId) throw AppError.badRequest('sourceMaterialId is required.');
  const material = await svc.replaceMaterialFromLibrary(req.params.id, sourceMaterialId, req.user!.id);
  sendCreated(res, material, 'Material replaced with a library file');
});

export const attachFromLibrary = asyncHandler(async (req: Request, res: Response) => {
  const materialId = (req.body?.materialId ?? '').toString();
  const topicId = (req.body?.topicId ?? '').toString();
  if (!materialId || !topicId) throw AppError.badRequest('materialId and topicId are required.');
  const material = await svc.attachLibraryMaterial(materialId, topicId, req.user!.id);
  sendCreated(res, material, 'Library material attached to topic');
});

export const setViewTime = asyncHandler(async (req: Request, res: Response) => {
  const { requiredViewSeconds } = updateMaterialSchema.parse(req.body);
  const applyToAll = (req.body as { applyToAll?: unknown }).applyToAll === true;
  sendSuccess(res, await svc.setRequiredViewSeconds(req.params.id, requiredViewSeconds, applyToAll), 'Reading time updated');
});

/** Reading-gate endpoints (server-enforced minimum reading time). */
export const startView = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await viewSvc.startMaterialView(req.user!.id, req.params.id), 'Reading session started');
});

export const completeView = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await viewSvc.completeMaterialView(req.user!.id, req.params.id), 'Material marked as read');
});

// A4: auto-save reading progress (elapsed seconds) so the session can resume.
export const saveViewProgress = asyncHandler(async (req: Request, res: Response) => {
  const elapsedSeconds = Number((req.body as { elapsedSeconds?: unknown }).elapsedSeconds);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw AppError.badRequest('elapsedSeconds must be a non-negative number.');
  sendSuccess(res, await viewSvc.saveMaterialProgress(req.user!.id, req.params.id, elapsedSeconds), 'Reading progress saved');
});

// // Page-coverage control: credit the page currently on screen. Whether it is actually
// // credited is decided server-side against the per-page dwell interval.
// export const recordPageView = asyncHandler(async (req: Request, res: Response) => {
  // const page = Number((req.body as { page?: unknown }).page);
  // if (!Number.isInteger(page) || page < 1) throw AppError.badRequest('page must be a positive integer.');
  // sendSuccess(res, await viewSvc.recordPageView(req.user!.id, req.params.id, page));
// });
//
export const readingStatus = asyncHandler(async (req: Request, res: Response) => {
  const topicId = typeof req.query.topicId === 'string' ? req.query.topicId : '';
  if (!topicId) throw AppError.badRequest('topicId is required.');
  sendSuccess(res, await viewSvc.getReadingStatus(req.user!.id, topicId));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.deleteMaterial(req.params.id), 'Material deleted');
});

/** Discard a staged (pending) file before it has gone live — no reason required. */
export const discardStaged = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.discardStagedMaterial(req.params.id, req.user!.id), 'Pending file discarded');
});
