import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
import { env } from '../config/env';
import { ensureDir, validateUpload, scanFileForVirus, getExtension } from '../utils/fileUtils';
import { getNumber } from './systemConfig.service';
import { recordEvent } from './auditTrail.service';

export async function listByUser(userId: string) {
  return prisma.personalDocument.findMany({
    where: { userId, isDeleted: false },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getDoc(id: string) {
  const doc = await prisma.personalDocument.findFirst({ where: { id, isDeleted: false } });
  if (!doc) throw AppError.notFound('Document not found');
  return doc;
}

export async function uploadPersonalDoc(
  params: { userId: string; documentType: string; title: string },
  file: Express.Multer.File,
  createdBy: string,
) {
  const maxBytes = (await getNumber('upload.max_size_mb', 100)) * 1024 * 1024;
  validateUpload({ originalname: file.originalname, mimetype: file.mimetype, size: file.size }, maxBytes);
  await scanFileForVirus(file.path);

  ensureDir(env.storage.documents);
  const dest = path.join(env.storage.documents, file.filename);
  fs.renameSync(file.path, dest);

  const doc = await prisma.personalDocument.create({
    data: {
      userId: params.userId,
      documentType: params.documentType,
      title: params.title,
      originalFileName: file.originalname,
      storedFileName: file.filename,
      filePath: dest,
      createdBy,
    },
  });
  await recordEvent({ action: 'FILE_UPLOAD', entityType: 'PersonalDocument', entityId: doc.id, newValue: { title: params.title } });
  return doc;
}

export async function deletePersonalDoc(id: string) {
  await getDoc(id);
  return prisma.personalDocument.update({ where: { id }, data: { isDeleted: true } });
}
