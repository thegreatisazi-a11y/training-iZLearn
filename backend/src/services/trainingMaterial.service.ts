import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { validateUpload, scanFileForVirus, getExtension, generateStoredName } from '../utils/fileUtils';
import { getNumber } from './systemConfig.service';
import * as storage from './storage.service';
import { recordEvent } from './auditTrail.service';
import { snapshotVersion } from './topicVersionHistory.service';
import { isConvertibleOffice, ensureConvertedPdfKey } from './officeConvert.service';
import type { PaginationQuery } from '@izlearn/shared';

/** Object-storage key for a material's stored file. */
const materialKey = (storedFileName: string) => `materials/${storedFileName}`;
// BUG-02: course versions are no longer bumped on draft material changes (authoring must
// not inflate the version). The version only advances when published changes go live —
// see publishDraftChanges() in trainingTopic.service.ts.

/**
 * Training materials (Module 4) — the uploaded files (PDF/PPT/video/...) that
 * back a training course, plus a reusable material library.
 *
 *  - every upload is validated (extension + MIME + size) and virus-scanned
 *    before the file is moved out of the tmp dir into permanent storage.
 *  - STAGED workflow: a file added/replaced/attached on a PUBLISHED course is
 *    STAGED (isStaged:true, not current) and stays inert until the course is
 *    revised — the live/published version is never altered by simply adding a
 *    file. On a DRAFT/UNDER_REVIEW course (still being built) the file becomes
 *    current immediately, since there is no live version to protect.
 *  - on reviseTopic, staged files are promoted onto the new version and the prior
 *    current files are archived (see trainingTopic.service.ts).
 *  - soft-delete only; the upload/download events are recorded explicitly while
 *    the row create/delete is captured by the Prisma audit middleware.
 */

/** A topic whose live (published) version must be protected from in-place edits. */
function isPublished(status: string): boolean {
  return status === 'PUBLISHED';
}

/**
 * Item 1: block duplicate file names. A file whose name already matches an active
 * (non-deleted, non-obsolete) material is rejected. A course upload is checked against BOTH
 * that course AND the Material Library — the library is the controlled master set, so if the
 * file already exists there the user must attach it from the library instead of re-uploading
 * a second copy. Case-insensitive; superseded prior versions never count (Replace still works).
 */
async function assertNoDuplicateName(
  originalName: string,
  scope: { topicId: string; skipLibraryCheck?: boolean } | { library: true },
) {
  const base: Prisma.TrainingMaterialWhereInput = {
    isDeleted: false,
    isObsolete: false,
    originalFileName: { equals: originalName, mode: 'insensitive' },
  };
  // Library-level material is stored with an empty topicId. Skipped when attaching an existing
  // library file to a course (it is in the library by definition).
  if ('library' in scope || !scope.skipLibraryCheck) {
    const inLibrary = await prisma.trainingMaterial.findFirst({ where: { ...base, topicId: '' } });
    if (inLibrary) {
      throw AppError.badRequest(
        'library' in scope
          ? `A file named "${originalName}" already exists in the Material Library.`
          : `A file named "${originalName}" already exists in the Material Library. Attach it from the library instead of uploading another copy.`,
      );
    }
  }
  if (!('library' in scope)) {
    const inCourse = await prisma.trainingMaterial.findFirst({ where: { ...base, topicId: scope.topicId } });
    if (inCourse) {
      throw AppError.badRequest(`A file named "${originalName}" is already attached to this course.`);
    }
  }
}

export async function uploadMaterial(topicId: string, file: Express.Multer.File, createdBy: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training course not found');

  // Item 1: reject a duplicate file name in the same course so the same file can't be
  // uploaded twice. Case-insensitive; ignores superseded (obsolete) prior versions and
  // soft-deleted rows so Replace/Update still works.
  await assertNoDuplicateName(file.originalname, { topicId });

  const maxBytes = (await getNumber('upload.max_size_mb', 0)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  // Persist the file to object storage (R2 in prod; local-fs fallback in dev).
  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const staged = isPublished(topic.status);
  // A course legitimately holds MANY materials at once (e.g. a PDF + a video). Uploading
  // a new file ADDS a material — it must NOT demote/supersede the course's existing
  // current files (that is what Replace/Update is for). So on a draft the new file simply
  // becomes another current material; nothing else is touched.
  // BUG-02: authoring never bumps the course version — that only advances when published
  // changes go live (publishDraftChanges).

  // Use the highest existing version (not the count): materials are copied across
  // course revisions carrying their version numbers, so a raw count can fall BELOW an
  // existing version and make the next file go backwards (e.g. v5 → v4).
  const lastVersion = (await prisma.trainingMaterial.aggregate({ where: { topicId }, _max: { version: true } }))._max.version ?? 0;

  const material = await prisma.trainingMaterial.create({
    data: {
      topicId,
      originalFileName: file.originalname,
      storedFileName: file.filename,
      filePath: key,
      fileType: getExtension(file.originalname),
      fileSize: file.size,
      version: lastVersion + 1,
      // Published → staged (pending, inert until revise). Draft → current now.
      isStaged: staged,
      isCurrentVersion: !staged,
      createdBy,
    },
  });

  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { topicId, originalFileName: file.originalname, fileSize: file.size, staged },
  });

  return material;
}

/**
 * CR-MAT2/MAT3: Persist a single uploaded file as a LIBRARY-level material (no
 * course). Reuses the same validation (extension/MIME/size), virus-scan and
 * metadata capture (originalFileName/fileType/fileSize) as the single-upload
 * path, and records a FILE_UPLOAD audit event. The material is stored with an
 * empty topicId sentinel so it can later be reused into a course via
 * attachLibraryMaterial(). Pass `maxBytes` so a bulk loop resolves the size
 * limit once.
 */
async function persistLibraryMaterial(file: Express.Multer.File, createdBy: string, maxBytes: number) {
  // Item 1: reject a duplicate file name already in the Material Library.
  await assertNoDuplicateName(file.originalname, { library: true });
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const material = await prisma.trainingMaterial.create({
    data: {
      // Library-level: no owning course. Empty sentinel keeps the non-null schema
      // column satisfied; attach-from-library copies it into a course later.
      topicId: '',
      originalFileName: file.originalname,
      storedFileName: file.filename,
      filePath: key,
      fileType: getExtension(file.originalname),
      fileSize: file.size,
      version: 1,
      isStaged: false,
      isCurrentVersion: true,
      createdBy,
    },
  });

  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { library: true, originalFileName: file.originalname, fileType: material.fileType, fileSize: file.size },
  });

  return material;
}

/**
 * CR-MAT2: Bulk-upload multiple files into the Material Library. Each file goes
 * through the same single-file persist logic (validation + virus-scan + metadata
 * capture + FILE_UPLOAD audit). Files are library-level (no course) so they can be
 * reused into courses later. A failure on one file does not abort the rest; the
 * caller gets a summary of what uploaded and what failed.
 */
export async function bulkUploadMaterials(
  files: Express.Multer.File[],
  createdBy: string,
  opts?: { topicId?: string | null },
): Promise<{ uploaded: number; failed: number; materials: unknown[]; errors: { fileName: string; error: string }[] }> {
  const maxBytes = (await getNumber('upload.max_size_mb', 0)) * 1024 * 1024;
  const materials: unknown[] = [];
  const errors: { fileName: string; error: string }[] = [];

  for (const file of files) {
    try {
      const material = opts?.topicId
        ? await uploadMaterial(opts.topicId, file, createdBy)
        : await persistLibraryMaterial(file, createdBy, maxBytes);
      materials.push(material);
    } catch (err) {
      errors.push({ fileName: file.originalname, error: err instanceof Error ? err.message : 'Upload failed' });
    }
  }

  return { uploaded: materials.length, failed: errors.length, materials, errors };
}

/**
 * 4.1: Replace/Update a SPECIFIC material with a new uploaded file.
 *  - PUBLISHED course: the new file is STAGED against the selected material
 *    (replacesMaterialId) and supersedes it only when the course is revised. The
 *    live version is untouched.
 *  - DRAFT course: the selected file (and any other current files) are superseded
 *    immediately and the new file becomes current; a version-history snapshot is
 *    written. Reason-for-change is captured by the route middleware.
 */
export async function replaceMaterial(materialId: string, file: Express.Multer.File, createdBy: string) {
  const old = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!old) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findFirst({ where: { id: old.topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training course not found');

  const maxBytes = (await getNumber('upload.max_size_mb', 0)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const reason = auditContext.getStore()?.reasonForChange ?? null;
  // G3/G4: on a PUBLISHED course the replacement is STAGED (a draft change) — the live
  // current file is left untouched until "Publish changes" promotes it. On a DRAFT
  // course the old file is superseded immediately and the new one becomes current.
  const staged = isPublished(topic.status);
  if (!staged) {
    await prisma.trainingMaterial.updateMany({
      where: { topicId: old.topicId, isDeleted: false, isCurrentVersion: true },
      data: { isCurrentVersion: false, isObsolete: true, archivedAt: new Date(), archivedBy: createdBy, changeReason: reason },
    });
    // BUG-02: a draft replacement supersedes the old file but does NOT bump the course
    // version (no version churn during authoring); publishing changes bumps it instead.
  }

  const lastVersion = (await prisma.trainingMaterial.aggregate({ where: { topicId: old.topicId }, _max: { version: true } }))._max.version ?? 0;
  const material = await prisma.trainingMaterial.create({
    data: {
      topicId: old.topicId,
      originalFileName: file.originalname,
      storedFileName: file.filename,
      filePath: key,
      fileType: getExtension(file.originalname),
      fileSize: file.size,
      version: lastVersion + 1,
      isStaged: staged,
      isCurrentVersion: !staged,
      replacesMaterialId: old.id,
      changeReason: reason,
      createdBy,
    },
  });

  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { topicId: old.topicId, replacedMaterialId: old.id, originalFileName: file.originalname, fileSize: file.size },
  });

  // The superseded file is now in version history — snapshot the change.
  await snapshotVersion({
    topicId: old.topicId,
    version: topic.currentVersion,
    changedBy: createdBy,
    reason,
    note: `Replaced file "${old.originalFileName}" with "${file.originalname}"`,
  });

  return material;
}

/**
 * 4.2: Attach an existing Material Library file to a course. The source file is
 * copied on disk (independent lineage) and recorded as a new TrainingMaterial.
 *  - PUBLISHED course: the attached file is STAGED (inert until revise).
 *  - DRAFT course: it is ADDED as another current file. Attaching adds a material —
 *    it does not supersede the course's existing current files (use Replace for that),
 *    so multiple library files can be attached to a draft and all stay current.
 */
export async function attachLibraryMaterial(sourceMaterialId: string, topicId: string, createdBy: string) {
  const source = await prisma.trainingMaterial.findFirst({ where: { id: sourceMaterialId, isDeleted: false } });
  if (!source) throw AppError.notFound('Source material not found');
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training course not found');

  // Item 1: don't attach a library file whose name is already present in the course. The
  // library check is skipped here — this file comes FROM the library.
  await assertNoDuplicateName(source.originalFileName, { topicId, skipLibraryCheck: true });

  const storedFileName = generateStoredName(source.originalFileName);
  const destKey = materialKey(storedFileName);
  if (!(await storage.objectExists(source.filePath))) throw AppError.badRequest('The source file is no longer available in storage.');
  await storage.copyObject(source.filePath, destKey);

  const staged = isPublished(topic.status);
  // Attaching ADDS a material (see above): on a draft the file simply becomes another
  // current material — prior current files are left untouched.
  // BUG-02: authoring never bumps the course version; publishing changes bumps it instead.

  // Use the highest existing version (not the count): materials are copied across
  // course revisions carrying their version numbers, so a raw count can fall BELOW an
  // existing version and make the next file go backwards (e.g. v5 → v4).
  const lastVersion = (await prisma.trainingMaterial.aggregate({ where: { topicId }, _max: { version: true } }))._max.version ?? 0;
  const material = await prisma.trainingMaterial.create({
    data: {
      topicId,
      originalFileName: source.originalFileName,
      storedFileName,
      filePath: destKey,
      fileType: source.fileType,
      fileSize: source.fileSize,
      version: lastVersion + 1,
      isStaged: staged,
      isCurrentVersion: !staged,
      createdBy,
    },
  });

  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { topicId, copiedFromMaterialId: source.id, originalFileName: source.originalFileName, staged },
  });

  // Attaching to a draft is authoring (adding a file), not a controlled supersession —
  // no version-history snapshot is written (mirrors a plain upload). A published course's
  // attach is staged and captured when the changes are published.
  return material;
}

/**
 * 4.1 (library variant): Replace/Update a SPECIFIC material using a file from the
 * Material Library (instead of an uploaded file). Mirrors replaceMaterial exactly —
 * the selected file is superseded (replacesMaterialId), the library file's bytes are
 * copied into independent storage, and a version-history snapshot is written — but the
 * new file's content comes from an existing library material.
 *  - PUBLISHED course: STAGED against the target (inert until the course is published).
 *  - DRAFT course: superseded immediately, the copied file becomes current, course
 *    version bumped. Reason-for-change is captured by the route middleware.
 */
export async function replaceMaterialFromLibrary(materialId: string, sourceMaterialId: string, createdBy: string) {
  const old = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!old) throw AppError.notFound('Training material not found');
  const source = await prisma.trainingMaterial.findFirst({ where: { id: sourceMaterialId, isDeleted: false } });
  if (!source) throw AppError.notFound('Source library material not found');
  const topic = await prisma.trainingTopic.findFirst({ where: { id: old.topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training course not found');

  // Copy the source file to an independent stored object (own lineage), as attach does.
  const storedFileName = generateStoredName(source.originalFileName);
  const destKey = materialKey(storedFileName);
  if (!(await storage.objectExists(source.filePath))) throw AppError.badRequest('The source file is no longer available in storage.');
  await storage.copyObject(source.filePath, destKey);

  const reason = auditContext.getStore()?.reasonForChange ?? null;
  const staged = isPublished(topic.status);
  if (!staged) {
    await prisma.trainingMaterial.updateMany({
      where: { topicId: old.topicId, isDeleted: false, isCurrentVersion: true },
      data: { isCurrentVersion: false, isObsolete: true, archivedAt: new Date(), archivedBy: createdBy, changeReason: reason },
    });
    // BUG-02: draft library-replace supersedes the old file without bumping the version.
  }

  const lastVersion = (await prisma.trainingMaterial.aggregate({ where: { topicId: old.topicId }, _max: { version: true } }))._max.version ?? 0;
  const material = await prisma.trainingMaterial.create({
    data: {
      topicId: old.topicId,
      originalFileName: source.originalFileName,
      storedFileName,
      filePath: destKey,
      fileType: source.fileType,
      fileSize: source.fileSize,
      version: lastVersion + 1,
      isStaged: staged,
      isCurrentVersion: !staged,
      replacesMaterialId: old.id,
      changeReason: reason,
      createdBy,
    },
  });

  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { topicId: old.topicId, replacedMaterialId: old.id, copiedFromMaterialId: source.id, originalFileName: source.originalFileName, staged },
  });

  await snapshotVersion({
    topicId: old.topicId,
    version: topic.currentVersion,
    changedBy: createdBy,
    reason,
    note: `Replaced file "${old.originalFileName}" with "${source.originalFileName}" from the Material Library`,
  });

  return material;
}

/**
 * Resolve a course's version lineage (the course itself + all ancestor versions via
 * parentTopicId). Used so a managed view of a revised course also surfaces the
 * archived files that belonged to its previous versions.
 */
export async function lineageTopicIds(topicId: string): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = topicId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    ids.push(cursor);
    const t: { parentTopicId: string | null } | null = await prisma.trainingTopic.findUnique({
      where: { id: cursor },
      select: { parentTopicId: true },
    });
    cursor = t?.parentTopicId ?? null;
  }
  return ids;
}

export async function listMaterials(
  q: PaginationQuery & { topicId?: string; topicIds?: string[]; fileType?: string; onlyCurrent?: boolean },
) {
  const where: Prisma.TrainingMaterialWhereInput = {
    isDeleted: false,
    // UR-16: trainees (no material-management rights) may only see the current,
    // non-obsolete version of each material. Admins/coordinators see every version.
    ...(q.onlyCurrent ? { isCurrentVersion: true, isObsolete: false } : {}),
    ...(q.topicIds ? { topicId: { in: q.topicIds } } : q.topicId ? { topicId: q.topicId } : {}),
    ...(q.fileType ? { fileType: q.fileType } : {}),
    ...(q.search
      ? {
          OR: [
            { originalFileName: { contains: q.search, mode: 'insensitive' } },
            { fileType: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.trainingMaterial.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { [q.sortBy || 'createdAt']: q.sortDir },
    }),
    prisma.trainingMaterial.count({ where }),
  ]);
  return { data, total, page: q.page, pageSize: q.pageSize };
}

export async function getMaterial(id: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  return material;
}

/**
 * Resolve the storage key of a PDF rendering suitable for the locked in-app viewer.
 * Native PDFs pass through; Office documents (doc/docx/ppt/pptx/xls/xlsx) are converted
 * to PDF (cached) via LibreOffice so they render in the same locked pdf.js surface.
 * Images / video / audio are rendered directly by the client and never reach this path.
 */
export async function getViewablePdf(id: string): Promise<{ key: string; originalFileName: string }> {
  const material = await getMaterial(id);
  const ext = material.fileType.toLowerCase();
  if (ext === 'pdf') return { key: material.filePath, originalFileName: material.originalFileName };
  if (isConvertibleOffice(ext)) {
    const key = await ensureConvertedPdfKey(material);
    return { key, originalFileName: material.originalFileName };
  }
  throw AppError.badRequest('This file type cannot be shown as a PDF.');
}

/** Returns the storage key + display name + type; the controller streams the file. */
export async function downloadMaterial(id: string): Promise<{ key: string; originalFileName: string; fileType: string }> {
  const material = await getMaterial(id);
  await recordEvent({
    action: 'FILE_DOWNLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { originalFileName: material.originalFileName },
  });
  return { key: material.filePath, originalFileName: material.originalFileName, fileType: material.fileType };
}

/**
 * Set a material's required reading/viewing time (seconds). If `applyToAll`, the same
 * time is applied to every current material of the course. Afterwards the course
 * duration is recomputed from the total reading time (sum of current materials'
 * required seconds → minutes) and stored on the course, so the duration shown across
 * the app reflects the configured reading time.
 */
export async function setRequiredViewSeconds(id: string, seconds: number, applyToAll = false) {
  const material = await getMaterial(id);
  const topic = await prisma.trainingTopic.findFirst({ where: { id: material.topicId, isDeleted: false }, select: { id: true, status: true, draftMeta: true } });

  // A PUBLISHED course is a controlled record: a read-time change must NOT go live
  // directly. Stage it in draftMeta.materialReadTimes; it is applied (and the version
  // bumped) only when "Publish changes" is e-signed — see publishDraftChanges().
  if (topic && isPublished(topic.status)) {
    const targetIds = applyToAll
      ? (
          await prisma.trainingMaterial.findMany({
            where: { topicId: material.topicId, isDeleted: false, isCurrentVersion: true, isObsolete: false },
            select: { id: true },
          })
        ).map((m) => m.id)
      : [id];
    const draft = { ...((topic.draftMeta ?? {}) as Record<string, unknown>) };
    const readTimes: Record<string, number> = { ...((draft.materialReadTimes as Record<string, number>) ?? {}) };
    for (const mid of targetIds) readTimes[mid] = seconds;
    draft.materialReadTimes = readTimes;
    await prisma.trainingTopic.update({ where: { id: topic.id }, data: { draftMeta: draft as Prisma.InputJsonValue } });
    return getMaterial(id); // live material is unchanged until the staged change is published
  }

  // DRAFT / unpublished course: apply directly (no live version to protect).
  if (applyToAll) {
    await prisma.trainingMaterial.updateMany({
      where: { topicId: material.topicId, isDeleted: false, isCurrentVersion: true },
      data: { requiredViewSeconds: seconds },
    });
  } else {
    await prisma.trainingMaterial.update({ where: { id }, data: { requiredViewSeconds: seconds } });
  }
  await recomputeTopicDurationFromReadingTime(material.topicId);
  return getMaterial(id);
}

/**
 * Course duration = total required reading time of the current materials (rounded up to
 * whole minutes). Only updates when there is reading time configured, so a manually
 * entered duration isn't wiped on courses that don't gate reading time.
 */
export async function recomputeTopicDurationFromReadingTime(topicId: string) {
  const materials = await prisma.trainingMaterial.findMany({
    where: { topicId, isDeleted: false, isCurrentVersion: true, isObsolete: false },
    select: { requiredViewSeconds: true },
  });
  const totalSeconds = materials.reduce((sum, m) => sum + (m.requiredViewSeconds ?? 0), 0);
  if (totalSeconds <= 0) return; // no reading-time gate → keep any manual duration.
  const minutes = Math.ceil(totalSeconds / 60);
  await prisma.trainingTopic.update({ where: { id: topicId }, data: { durationMinutes: minutes } });
}

/** Soft-delete (the only kind of delete in izLearn). */
/** H1: a material attached to a PUBLISHED topic is part of the controlled record and
 * cannot be deleted by anyone (delete is only allowed while the course is unpublished). */
async function assertMaterialDeletable(material: { topicId: string }) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: material.topicId, isDeleted: false }, select: { status: true } });
  if (topic?.status === 'PUBLISHED') {
    throw AppError.conflict('This material is linked to a published course and cannot be deleted. Unpublish/archive the course first, or replace the file through the controlled version flow.');
  }
}

export async function deleteMaterial(id: string) {
  const material = await getMaterial(id);
  await assertMaterialDeletable(material);
  return prisma.trainingMaterial.update({ where: { id }, data: { isDeleted: true } });
}

/**
 * Discard a STAGED (pending) file before it has ever gone live. No reason is
 * required because the file never affected any published version; it is simply
 * soft-deleted. Refuses to touch a non-staged (live/archived) material.
 */
export async function discardStagedMaterial(id: string, actorId: string) {
  const material = await getMaterial(id);
  if (!material.isStaged) {
    throw AppError.badRequest('Only a staged (pending) file can be discarded. Use delete for live materials.');
  }
  const updated = await prisma.trainingMaterial.update({ where: { id }, data: { isDeleted: true } });
  await recordEvent({
    action: 'SOFT_DELETE',
    entityType: 'TrainingMaterial',
    entityId: id,
    newValue: { discardedStaged: true, originalFileName: material.originalFileName, actorId },
  });
  return updated;
}

// ============================================================================
// Global "training instruction" file (shown to every trainee before reading).
// Exactly one library-level material is flagged isInstruction at a time. It is
// versioned via replaceInstruction (the previous file is archived) and cleared when
// the material is deleted. getCurrentInstruction drives the Start-Training gate.
// ============================================================================

/** The current global instruction material (or null if none is set). */
export async function getCurrentInstruction() {
  return prisma.trainingMaterial.findFirst({
    where: { isInstruction: true, isDeleted: false },
    orderBy: { version: 'desc' },
    select: { id: true, originalFileName: true, fileType: true, version: true },
  });
}

/**
 * Flag an existing LIBRARY material as the global instruction (or unset it). At most
 * one material is ever flagged — setting a new one clears the previous.
 */
export async function setInstruction(materialId: string, on: boolean, actorId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  if (on && material.topicId) {
    throw AppError.badRequest('Only a Material Library file (not one attached to a course) can be set as the training instruction.');
  }
  if (on) {
    // Clear any other current instruction first so exactly one stays active.
    await prisma.trainingMaterial.updateMany({ where: { isInstruction: true, id: { not: materialId } }, data: { isInstruction: false } });
  }
  const updated = await prisma.trainingMaterial.update({ where: { id: materialId }, data: { isInstruction: on } });
  await recordEvent({
    action: 'UPDATE',
    entityType: 'TrainingMaterial',
    entityId: materialId,
    newValue: { isInstruction: on, originalFileName: material.originalFileName, actorId },
  });
  return updated;
}

/**
 * Update the instruction with a NEW uploaded file: the new file becomes the current
 * instruction (version + 1) and the previous instruction file is archived (kept for
 * history). "The latest is reflected" — every trainee then sees the new file.
 */
export async function replaceInstruction(file: Express.Multer.File, createdBy: string) {
  const maxBytes = (await getNumber('upload.max_size_mb', 0)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const current = await prisma.trainingMaterial.findFirst({ where: { isInstruction: true, isDeleted: false }, orderBy: { version: 'desc' } });
  // Archive the previous instruction (retain history), clearing its instruction flag.
  if (current) {
    await prisma.trainingMaterial.update({
      where: { id: current.id },
      data: { isInstruction: false, isCurrentVersion: false, isObsolete: true, archivedAt: new Date(), archivedBy: createdBy },
    });
  }
  const material = await prisma.trainingMaterial.create({
    data: {
      topicId: '',
      originalFileName: file.originalname,
      storedFileName: file.filename,
      filePath: key,
      fileType: getExtension(file.originalname),
      fileSize: file.size,
      version: (current?.version ?? 0) + 1,
      isCurrentVersion: true,
      isInstruction: true,
      replacesMaterialId: current?.id ?? null,
      createdBy,
    },
  });
  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { instruction: true, replacedMaterialId: current?.id ?? null, originalFileName: file.originalname, version: material.version },
  });
  return material;
}

/** Record that a trainee acknowledged the instruction before starting training. */
export async function acknowledgeInstruction(userId: string, materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false }, select: { id: true, version: true, originalFileName: true } });
  if (!material) throw AppError.notFound('Instruction not found');
  await recordEvent({
    action: 'ACKNOWLEDGE',
    entityType: 'TrainingMaterial',
    entityId: materialId,
    // The acting user (the trainee) is taken from the request's audit context; also
    // recorded explicitly here for a self-contained record.
    newValue: { instructionAcknowledged: true, version: material.version, originalFileName: material.originalFileName, byUserId: userId },
  });
  return { acknowledged: true };
}
