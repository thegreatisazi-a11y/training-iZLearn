import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';

/**
 * Server-side enforcement of minimum material reading/viewing time (GMP training
 * control). The elapsed wall-clock between startedAt (server) and the completion
 * call is validated server-side, so a client cannot skip the required time or
 * bypass it by calling /complete early or hitting the assessment URL directly.
 */

function requiredFor(material: { requiredViewSeconds: number | null }, topic: { materialViewSeconds: number | null } | null): number {
  return material.requiredViewSeconds ?? topic?.materialViewSeconds ?? 0;
}

/** Begin (or resume) a reading session for a material — records the server start time. */
export async function startMaterialView(userId: string, materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  const requiredSeconds = requiredFor(material, topic);

  const existing = await prisma.materialViewLog.findUnique({
    where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
  });
  if (existing) return { ...existing, requiredSeconds };
  const created = await prisma.materialViewLog.create({
    data: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds },
  });
  return { ...created, requiredSeconds };
}

/** Mark a material as read — only succeeds once the required wall-clock time has elapsed. */
export async function completeMaterialView(userId: string, materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  const requiredSeconds = requiredFor(material, topic);

  const log = await prisma.materialViewLog.findUnique({
    where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
  });
  if (!log) throw AppError.badRequest('Reading session was not started for this material.');
  if (log.isCompleted) return log;

  // Server-validated elapsed time (1s grace for network/UI latency).
  const elapsedSeconds = (Date.now() - log.startedAt.getTime()) / 1000;
  if (elapsedSeconds + 1 < requiredSeconds) {
    throw AppError.badRequest(`Minimum reading time not met (${Math.ceil(requiredSeconds - elapsedSeconds)}s remaining).`);
  }
  return prisma.materialViewLog.update({ where: { id: log.id }, data: { isCompleted: true, completedAt: new Date() } });
}

/**
 * True when every current material that has a required reading time has a COMPLETED
 * view log for this user + topic version. Topics with no timed materials pass freely.
 */
export async function hasCompletedRequiredReading(userId: string, topicId: string, topicVersion: number): Promise<boolean> {
  const [materials, topic] = await Promise.all([
    prisma.trainingMaterial.findMany({ where: { topicId, isDeleted: false, isCurrentVersion: true, isObsolete: false } }),
    prisma.trainingTopic.findUnique({ where: { id: topicId } }),
  ]);
  const required = materials.filter((m) => requiredFor(m, topic) > 0);
  if (required.length === 0) return true;
  const logs = await prisma.materialViewLog.findMany({ where: { userId, topicId, topicVersion, isCompleted: true } });
  const done = new Set(logs.map((l) => l.materialId));
  return required.every((m) => done.has(m.id));
}

/** Per-material reading status for the current user + version (drives the UI). */
export async function getReadingStatus(userId: string, topicId: string) {
  const topic = await prisma.trainingTopic.findUnique({ where: { id: topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  const materials = await prisma.trainingMaterial.findMany({
    where: { topicId, isDeleted: false, isCurrentVersion: true, isObsolete: false },
    orderBy: { version: 'asc' },
  });
  const logs = await prisma.materialViewLog.findMany({ where: { userId, topicId, topicVersion } });
  const logByMat = new Map(logs.map((l) => [l.materialId, l]));
  return materials.map((m) => {
    const log = logByMat.get(m.id);
    return {
      materialId: m.id,
      originalFileName: m.originalFileName,
      fileType: m.fileType,
      requiredSeconds: requiredFor(m, topic),
      isCompleted: log?.isCompleted ?? false,
    };
  });
}
