import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { validateUpload, scanFileForVirus, getExtension, generateStoredName } from '../utils/fileUtils';
import { getNumber } from './systemConfig.service';
import * as storage from './storage.service';
import { recordEvent } from './auditTrail.service';
import { snapshotVersion } from './topicVersionHistory.service';
import type { PaginationQuery } from '@izlearn/shared';

/** Object-storage key for a material's stored file. */
const materialKey = (storedFileName: string) => `materials/${storedFileName}`;

/**
 * Training materials (Module 4) — the uploaded files (PDF/PPT/video/...) that
 * back a training topic, plus a reusable material library.
 *
 *  - every upload is validated (extension + MIME + size) and virus-scanned
 *    before the file is moved out of the tmp dir into permanent storage.
 *  - STAGED workflow: a file added/replaced/attached on a PUBLISHED topic is
 *    STAGED (isStaged:true, not current) and stays inert until the topic is
 *    revised — the live/published version is never altered by simply adding a
 *    file. On a DRAFT/UNDER_REVIEW topic (still being built) the file becomes
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

export async function uploadMaterial(topicId: string, file: Express.Multer.File, createdBy: string) {
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');

  const maxBytes = (await getNumber('upload.max_size_mb', 100)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  // Persist the file to object storage (R2 in prod; local-fs fallback in dev).
  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const staged = isPublished(topic.status);
  if (!staged) {
    // Draft topic: a new upload becomes the current version; demote prior current ones.
    await prisma.trainingMaterial.updateMany({
      where: { topicId, isDeleted: false, isCurrentVersion: true },
      data: { isCurrentVersion: false },
    });
  }

  // Use the highest existing version (not the count): materials are copied across
  // topic revisions carrying their version numbers, so a raw count can fall BELOW an
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
 * topic). Reuses the same validation (extension/MIME/size), virus-scan and
 * metadata capture (originalFileName/fileType/fileSize) as the single-upload
 * path, and records a FILE_UPLOAD audit event. The material is stored with an
 * empty topicId sentinel so it can later be reused into a topic via
 * attachLibraryMaterial(). Pass `maxBytes` so a bulk loop resolves the size
 * limit once.
 */
async function persistLibraryMaterial(file: Express.Multer.File, createdBy: string, maxBytes: number) {
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const material = await prisma.trainingMaterial.create({
    data: {
      // Library-level: no owning topic. Empty sentinel keeps the non-null schema
      // column satisfied; attach-from-library copies it into a topic later.
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
 * capture + FILE_UPLOAD audit). Files are library-level (no topic) so they can be
 * reused into topics later. A failure on one file does not abort the rest; the
 * caller gets a summary of what uploaded and what failed.
 */
export async function bulkUploadMaterials(
  files: Express.Multer.File[],
  createdBy: string,
  opts?: { topicId?: string | null },
): Promise<{ uploaded: number; failed: number; materials: unknown[]; errors: { fileName: string; error: string }[] }> {
  const maxBytes = (await getNumber('upload.max_size_mb', 100)) * 1024 * 1024;
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
 *  - PUBLISHED topic: the new file is STAGED against the selected material
 *    (replacesMaterialId) and supersedes it only when the topic is revised. The
 *    live version is untouched.
 *  - DRAFT topic: the selected file (and any other current files) are superseded
 *    immediately and the new file becomes current; a version-history snapshot is
 *    written. Reason-for-change is captured by the route middleware.
 */
export async function replaceMaterial(materialId: string, file: Express.Multer.File, createdBy: string) {
  const old = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!old) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findFirst({ where: { id: old.topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');

  const maxBytes = (await getNumber('upload.max_size_mb', 100)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  const key = materialKey(file.filename);
  await storage.putFile(key, file.path, file.mimetype);

  const staged = isPublished(topic.status);
  if (!staged) {
    // Draft topic: supersede the selected/current files immediately (kept as history).
    await prisma.trainingMaterial.updateMany({
      where: { topicId: old.topicId, isDeleted: false, isCurrentVersion: true },
      data: { isCurrentVersion: false, isObsolete: true },
    });
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
      // On a published topic, record which current file this staged upload replaces.
      replacesMaterialId: staged ? old.id : null,
      createdBy,
    },
  });

  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'TrainingMaterial',
    entityId: material.id,
    newValue: { topicId: old.topicId, replacedMaterialId: old.id, originalFileName: file.originalname, fileSize: file.size, staged },
  });

  // For a draft, the supersession happened now → snapshot it. For a published
  // topic the supersession is deferred to revise, so no snapshot here.
  if (!staged) {
    await snapshotVersion({
      topicId: old.topicId,
      version: topic.currentVersion,
      changedBy: createdBy,
      reason: auditContext.getStore()?.reasonForChange ?? null,
      note: `Replaced file "${old.originalFileName}" with "${file.originalname}"`,
    });
  }

  return material;
}

/**
 * 4.2: Attach an existing Material Library file to a topic. The source file is
 * copied on disk (independent lineage) and recorded as a new TrainingMaterial.
 *  - PUBLISHED topic: the attached file is STAGED (inert until revise).
 *  - DRAFT topic: it becomes the current version immediately; prior current files
 *    are superseded and a version-history snapshot is written.
 */
export async function attachLibraryMaterial(sourceMaterialId: string, topicId: string, createdBy: string) {
  const source = await prisma.trainingMaterial.findFirst({ where: { id: sourceMaterialId, isDeleted: false } });
  if (!source) throw AppError.notFound('Source material not found');
  const topic = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
  if (!topic) throw AppError.notFound('Training topic not found');

  const storedFileName = generateStoredName(source.originalFileName);
  const destKey = materialKey(storedFileName);
  if (!(await storage.objectExists(source.filePath))) throw AppError.badRequest('The source file is no longer available in storage.');
  await storage.copyObject(source.filePath, destKey);

  const staged = isPublished(topic.status);
  if (!staged) {
    // Draft topic: the attached file becomes current; demote prior current ones.
    await prisma.trainingMaterial.updateMany({
      where: { topicId, isDeleted: false, isCurrentVersion: true },
      data: { isCurrentVersion: false, isObsolete: true },
    });
  }

  // Use the highest existing version (not the count): materials are copied across
  // topic revisions carrying their version numbers, so a raw count can fall BELOW an
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

  if (!staged) {
    await snapshotVersion({
      topicId,
      version: topic.currentVersion,
      changedBy: createdBy,
      reason: auditContext.getStore()?.reasonForChange ?? null,
      note: `Attached "${source.originalFileName}" from the Material Library`,
    });
  }

  return material;
}

/**
 * Resolve a topic's version lineage (the topic itself + all ancestor versions via
 * parentTopicId). Used so a managed view of a revised topic also surfaces the
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
    ...(q.search ? { originalFileName: { contains: q.search, mode: 'insensitive' } } : {}),
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

/** Set a material's required reading/viewing time (seconds). */
export async function setRequiredViewSeconds(id: string, seconds: number) {
  await getMaterial(id);
  return prisma.trainingMaterial.update({ where: { id }, data: { requiredViewSeconds: seconds } });
}

/** Soft-delete (the only kind of delete in izLearn). */
export async function deleteMaterial(id: string) {
  await getMaterial(id);
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
