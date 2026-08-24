import { prisma } from '../config/prisma';
import { AppError } from '../utils/response';
// import { coverageUnitFor, hasCoverageUnits, resolveMaterialPageCount, type CoverageUnit } from './documentPages.service';

/**
 * Server-side enforcement of minimum material reading/viewing time (GMP training
 * control). The elapsed wall-clock between startedAt (server) and the completion
 * call is validated server-side, so a client cannot skip the required time or
 * bypass it by calling /complete early or hitting the assessment URL directly.
 // * Server-side enforcement of the two reading controls that must both be satisfied before a
 // * material counts as read (and therefore before the read-and-understood acknowledgement is
 // * offered and the assessment unlocks):
 // *
 // *   1. MINIMUM TIME — the elapsed wall-clock between startedAt (server) and the completion
 // *      call, so a client cannot skip the required time or bypass it by calling /complete
 // *      early or hitting the assessment URL directly.
 // *   2. PAGE COVERAGE — every page of a paginated document (pdf, and Word/PowerPoint/Excel
 // *      rendered to pdf) must have been dwelled on. Pages are credited one at a time against
 // *      the SERVER clock, so scrolling straight to the last page, or replaying a page event
 // *      for every page at once, does not satisfy it.
 // *
 // * Both are deliberately evaluated server-side: the client is treated as untrusted input.
 */

// /** Floor for per-page dwell, and the ceiling that a long total reading time is clamped to. */
// const MIN_PAGE_DWELL_SECONDS = 2;
// const MAX_PAGE_DWELL_SECONDS = 60;
// /** Latency grace, mirroring the 1s grace already applied to the total-time check. */
// const DWELL_GRACE_SECONDS = 0.5;
//
// type MaterialLike = {
  // id: string;
  // filePath: string;
  // fileType: string;
  // // Lets an oversized workbook be skipped without reading its bytes from storage.
  // fileSize: number;
  // pageCount: number | null;
  // requiredViewSeconds: number | null;
  // requirePageCoverage: boolean | null;
// };
// type TopicLike = { materialViewSeconds: number | null; requirePageCoverage: boolean } | null;
//
function requiredFor(material: { requiredViewSeconds: number | null }, topic: { materialViewSeconds: number | null } | null): number {
  return material.requiredViewSeconds ?? topic?.materialViewSeconds ?? 0;
}

/** Begin (or resume) a reading session for a material — records the server start time. */
export async function startMaterialView(userId: string, materialId: string) {
// /** Per-material override wins; otherwise the topic-level setting (default on). */
// function coverageEnabled(material: MaterialLike, topic: TopicLike): boolean {
  // return material.requirePageCoverage ?? topic?.requirePageCoverage ?? true;
// }
//
// /**
 // * How many pages this material requires the user to cover, or null when coverage does not
 // * apply — the type does not paginate (video/audio/image/text), coverage is switched off, or
 // * the page count could not be derived. Null keeps the material on the time gate alone.
 // */
// async function pageTargetFor(material: MaterialLike, topic: TopicLike, resolve = true): Promise<number | null> {
  // if (!coverageEnabled(material, topic) || !hasCoverageUnits(material.fileType)) return null;
  // // resolve = false uses only an already-cached count, never triggering an Office→PDF
  // // conversion. Used by read-only/list callers where a stale null is merely cosmetic.
  // return resolve ? resolveMaterialPageCount(material) : material.pageCount;
// }
//
// /** Pages are credited no faster than an even share of the required time, within sane bounds. */
// function minDwellFor(requiredSeconds: number, totalPages: number): number {
  // if (totalPages <= 0) return MIN_PAGE_DWELL_SECONDS;
  // const share = requiredSeconds > 0 ? Math.floor(requiredSeconds / totalPages) : 0;
  // return Math.min(MAX_PAGE_DWELL_SECONDS, Math.max(MIN_PAGE_DWELL_SECONDS, share));
// }
//
// function isCovered(pagesViewed: number[], totalPages: number | null): boolean {
  // if (totalPages == null) return true;
  // const seen = new Set(pagesViewed);
  // for (let p = 1; p <= totalPages; p++) if (!seen.has(p)) return false;
  // return true;
// }
//
// /** Load a material plus its topic, or fail. */
// async function loadContext(materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  // return { material: material as MaterialLike & { topicId: string }, topic: topic as TopicLike & { currentVersion?: number } | null, topicVersion: topic?.currentVersion ?? 1 };
// }
//
// /** Begin (or resume) a reading session for a material — records the server start time. */
// export async function startMaterialView(userId: string, materialId: string) {
  // const { material, topic, topicVersion } = await loadContext(materialId);
  const requiredSeconds = requiredFor(material, topic);
  // const totalPages = await pageTargetFor(material, topic);

  const existing = await prisma.materialViewLog.findUnique({
    where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
  });
  if (existing) return { ...existing, requiredSeconds };
  // if (existing) {
    // // Backfill totalPages on a log created before the page count was resolvable.
    // if (existing.totalPages == null && totalPages != null) {
      // const updated = await prisma.materialViewLog.update({ where: { id: existing.id }, data: { totalPages } });
      // return { ...updated, requiredSeconds };
    // }
    // return { ...existing, requiredSeconds };
  // }
  const created = await prisma.materialViewLog.create({
    data: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds },
    // data: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds, totalPages },
  });
  return { ...created, requiredSeconds };
}

/**
 * A4: persist accumulated reading time for a material so a session closed before the
 * assessment can resume where it left off. Monotonic — never decreases the stored value.
 */
export async function saveMaterialProgress(userId: string, materialId: string, elapsedSeconds: number) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  // const { material, topic, topicVersion } = await loadContext(materialId);
  const requiredSeconds = requiredFor(material, topic);

  const log = await prisma.materialViewLog.upsert({
    where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
    update: {},
    create: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds },
  });
  const next = Math.max(log.elapsedSeconds ?? 0, Math.max(0, Math.floor(elapsedSeconds)));
  if (next === (log.elapsedSeconds ?? 0)) return log;
  return prisma.materialViewLog.update({ where: { id: log.id }, data: { elapsedSeconds: next } });
}

/** Mark a material as read — only succeeds once the required wall-clock time has elapsed. */
// /**
 // * Credit one page as read. The page number is taken from the client (it is the page actually
 // * on screen), but WHETHER it is credited is decided by the server clock: at least the
 // * per-page dwell must have passed since the previously credited page (or since the reading
 // * session opened, for the first page). That makes the control resistant to a client that
 // * jumps to the last page or fires an event for every page at once.
 // *
 // * Returns the coverage state so the viewer can keep its progress display in sync.
 // */
// export async function recordPageView(userId: string, materialId: string, page: number) {
  // const { material, topic, topicVersion } = await loadContext(materialId);
  // const requiredSeconds = requiredFor(material, topic);
  // const totalPages = await pageTargetFor(material, topic);
//
  // const log = await prisma.materialViewLog.upsert({
    // where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
    // update: totalPages != null ? { totalPages } : {},
    // create: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds, totalPages },
  // });
//
  // const state = (pagesViewed: number[]) => ({
    // materialId,
    // coverageUnit: coverageUnitFor(material.fileType),
    // totalPages,
    // pagesViewed,
    // pagesRemaining: totalPages == null ? 0 : Math.max(0, totalPages - pagesViewed.filter((p) => p >= 1 && p <= totalPages).length),
    // isCovered: isCovered(pagesViewed, totalPages),
  // });
//
  // // Coverage does not apply to this material, or the page is outside the real document.
  // if (totalPages == null || !Number.isInteger(page) || page < 1 || page > totalPages) return state(log.pagesViewed ?? []);
//
  // const already = log.pagesViewed ?? [];
  // if (already.includes(page)) return state(already);
//
  // const reference = log.lastPageAt ?? log.startedAt;
  // const sinceLast = (Date.now() - reference.getTime()) / 1000;
  // const minDwell = minDwellFor(requiredSeconds, totalPages);
  // // Not dwelled long enough yet — silently leave the page uncredited; the viewer retries.
  // if (sinceLast + DWELL_GRACE_SECONDS < minDwell) return state(already);
//
  // const pagesViewed = [...already, page].sort((a, b) => a - b);
  // await prisma.materialViewLog.update({ where: { id: log.id }, data: { pagesViewed, lastPageAt: new Date() } });
  // return state(pagesViewed);
// }
//
// /**
 // * Mark a material as read. Succeeds only once BOTH the required wall-clock time has elapsed
 // * and (where it applies) every page has been covered.
 // */
export async function completeMaterialView(userId: string, materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  // const { material, topic, topicVersion } = await loadContext(materialId);
  const requiredSeconds = requiredFor(material, topic);
  // const totalPages = await pageTargetFor(material, topic);

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
//
  // // Server-validated page coverage.
  // const pagesViewed = log.pagesViewed ?? [];
  // if (!isCovered(pagesViewed, totalPages)) {
    // const remaining = (totalPages ?? 0) - pagesViewed.filter((p) => p >= 1 && p <= (totalPages ?? 0)).length;
    // const unit = coverageUnitFor(material.fileType) === 'sheet' ? 'sheet' : 'page';
    // throw AppError.badRequest(
      // `All ${totalPages} ${unit}s of this document must be read before it can be marked as read (${remaining} ${unit}(s) remaining).`,
    // );
  // }
//
  return prisma.materialViewLog.update({ where: { id: log.id }, data: { isCompleted: true, completedAt: new Date() } });
}

/**
 * True when every current material that has a required reading time has a COMPLETED
 * view log for this user + topic version. Topics with no timed materials pass freely.
 // * True when every GATED material for this topic version has a COMPLETED view log for this
 // * user. A material is gated when it has a required reading time OR requires page coverage,
 // * so a document with no timer still has to be read through to the last page. Topics whose
 // * materials are neither timed nor paginated pass freely.
 */
export async function hasCompletedRequiredReading(userId: string, topicId: string, topicVersion: number): Promise<boolean> {
// export async function hasCompletedRequiredReading(
  // userId: string,
  // topicId: string,
  // topicVersion: number,
  // /**
   // * Whether an unresolved page count may be derived here. Defaults to true so this stays
   // * authoritative wherever it gates. Pass false from list/dashboard callers that invoke it
   // * once per row: resolving would fire an Office→PDF conversion per material, and there the
   // * answer only decides which button a row shows — completeMaterialView remains the real
   // * enforcement point either way.
   // */
  // opts: { resolvePageCounts?: boolean } = {},
// ): Promise<boolean> {
  // const resolve = opts.resolvePageCounts !== false;
  const [materials, topic] = await Promise.all([
    prisma.trainingMaterial.findMany({ where: { topicId, isDeleted: false, isCurrentVersion: true, isObsolete: false } }),
    prisma.trainingTopic.findUnique({ where: { id: topicId } }),
  ]);
  const required = materials.filter((m) => requiredFor(m, topic) > 0);
  if (required.length === 0) return true;
  // const gated: string[] = [];
  // for (const m of materials as MaterialLike[]) {
    // // Short-circuit: a timed material is gated regardless of pagination, and skipping
    // // pageTargetFor avoids triggering an Office→PDF conversion just to answer this.
    // const gate = requiredFor(m, topic as TopicLike) > 0 || (await pageTargetFor(m, topic as TopicLike, resolve)) != null;
    // if (gate) gated.push(m.id);
  // }
  // if (gated.length === 0) return true;
  const logs = await prisma.materialViewLog.findMany({ where: { userId, topicId, topicVersion, isCompleted: true } });
  const done = new Set(logs.map((l) => l.materialId));
  return required.every((m) => done.has(m.id));
  // return gated.every((id) => done.has(id));
}

/** Per-material reading status for the current user + version (drives the UI). */
export async function getReadingStatus(userId: string, topicId: string) {
  const topic = await prisma.trainingTopic.findUnique({ where: { id: topicId } });
  // const topic = (await prisma.trainingTopic.findUnique({ where: { id: topicId } })) as (TopicLike & { currentVersion?: number }) | null;
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
      // A4: resume support — how far the user had read previously.
      elapsedSeconds: log?.elapsedSeconds ?? 0,
    };
  });
//
  // return Promise.all(
    // (materials as unknown as (MaterialLike & { originalFileName: string })[]).map(async (m) => {
      // const log = logByMat.get(m.id);
      // const totalPages = await pageTargetFor(m, topic);
      // const pagesViewed = log?.pagesViewed ?? [];
      // return {
        // materialId: m.id,
        // originalFileName: m.originalFileName,
        // fileType: m.fileType,
        // requiredSeconds: requiredFor(m, topic),
        // isCompleted: log?.isCompleted ?? false,
        // // A4: resume support — how far the user had read previously.
        // elapsedSeconds: log?.elapsedSeconds ?? 0,
        // // Coverage state: totalPages null = coverage does not apply to this material.
        // // coverageUnit tells the UI whether to say "pages" or "sheets".
        // coverageUnit: coverageUnitFor(m.fileType) as CoverageUnit | null,
        // totalPages,
        // pagesViewed,
        // pagesRemaining: totalPages == null ? 0 : Math.max(0, totalPages - pagesViewed.filter((p) => p >= 1 && p <= totalPages).length),
        // isCovered: isCovered(pagesViewed, totalPages),
      // };
    // }),
  // );
}
