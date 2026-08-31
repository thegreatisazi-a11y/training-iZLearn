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
// /** Per-material override wins; otherwise the course-level setting (default on). */
// function coverageEnabled(material: MaterialLike, course: TopicLike): boolean {
  // return material.requirePageCoverage ?? course?.requirePageCoverage ?? true;
// }
//
// /**
 // * How many pages this material requires the user to cover, or null when coverage does not
 // * apply — the type does not paginate (video/audio/image/text), coverage is switched off, or
 // * the page count could not be derived. Null keeps the material on the time gate alone.
 // */
// async function pageTargetFor(material: MaterialLike, course: TopicLike, resolve = true): Promise<number | null> {
  // if (!coverageEnabled(material, course) || !hasCoverageUnits(material.fileType)) return null;
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
// /** Load a material plus its course, or fail. */
// async function loadContext(materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  // return { material: material as MaterialLike & { topicId: string }, course: course as TopicLike & { currentVersion?: number } | null, topicVersion: course?.currentVersion ?? 1 };
// }
//
// /** Begin (or resume) a reading session for a material — records the server start time. */
// export async function startMaterialView(userId: string, materialId: string) {
  // const { material, course, topicVersion } = await loadContext(materialId);
  const requiredSeconds = requiredFor(material, topic);
  // const totalPages = await pageTargetFor(material, course);

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
  // const { material, course, topicVersion } = await loadContext(materialId);
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

/**
 * Record that the user has reached the LAST page of this material. Deliberately a single flag,
 * not per-page coverage: scrolling/jumping straight to the last page counts. Combined with the
 * per-material reading time, this gates when the "read and understood" declaration appears.
 * Idempotent — reaching the end again is a no-op.
 */
export async function markLastPageReached(userId: string, materialId: string) {
  const material = await prisma.trainingMaterial.findFirst({ where: { id: materialId, isDeleted: false } });
  if (!material) throw AppError.notFound('Training material not found');
  const topic = await prisma.trainingTopic.findUnique({ where: { id: material.topicId } });
  const topicVersion = topic?.currentVersion ?? 1;
  const requiredSeconds = requiredFor(material, topic);
  const log = await prisma.materialViewLog.upsert({
    where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
    update: {},
    create: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds },
  });
  if (log.reachedLastPage) return log;
  return prisma.materialViewLog.update({ where: { id: log.id }, data: { reachedLastPage: true } });
}

/**
 * File types with no "last page" to reach, so the end-of-document gate does not apply:
 *  - media (image/video/audio) — shown whole in a native player, nothing to page through;
 *  - plain-text types — rendered as a short read-only block (these must match the frontend's
 *    TEXT_EXTS, otherwise the gate could never be satisfied for them).
 * Everything else (pdf, doc/docx, ppt/pptx, xls/xlsx) is scrollable and IS gated.
 */
const NON_PAGINATED = new Set([
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'mp3', 'wav', 'ogg', 'm4a',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
  'txt', 'csv', 'log', 'md', 'json',
]);
export function paginates(fileType: string): boolean {
  return !NON_PAGINATED.has((fileType || '').toLowerCase());
}

/**
 * The acknowledgement ("I have read and understood the training contents.") must be given in the
 * SAME run that finishes the reading. If a user satisfied every material (required time met AND
 * last page reached) but left without acknowledging, their reading progress is cleared so they
 * must read again — otherwise the declaration could be dodged indefinitely by just closing the
 * tab. Called when the reading screen is (re)opened.
 *
 * Only ever clears an IN-PROGRESS, un-acknowledged run. It never touches reading that has
 * already been acknowledged: an assessment attempt can only be STARTED after the declaration is
 * ticked, and a reading-only course records a passed attempt when it is acknowledged — so the
 * existence of ANY attempt for this course version is proof the declaration was given. (Checking
 * only for a *passed* attempt was wrong: a user who acknowledged, started the assessment and
 * then left or failed had their reading wiped and was forced to read it all again.)
 */
export async function resetUnacknowledgedReading(userId: string, topicId: string): Promise<boolean> {
  const topic = await prisma.trainingTopic.findUnique({ where: { id: topicId } });
  if (!topic) return false;
  const topicVersion = topic.currentVersion ?? 1;

  // Any attempt at this version → the declaration was already given; never reset.
  const acknowledged = await prisma.assessmentAttempt.findFirst({
    where: { userId, topicId, topicVersion, isDeleted: false },
  });
  if (acknowledged) return false;

  // Reset ONLY when the declaration was actually shown to the trainee on a previous visit. This
  // is a recorded fact (markAcknowledgementAvailable), not re-derived from time/pages here — any
  // mismatch between what the client showed and what the server would infer could otherwise wipe
  // a part-finished run that must simply resume.
  const shown = await prisma.materialViewLog.findFirst({
    where: { userId, topicId, topicVersion, ackAvailableAt: { not: null } },
    select: { id: true },
  });
  if (!shown) return false; // declaration never appeared → normal resume, nothing cleared

  // Shown but never acknowledged → start the reading over.
  await prisma.materialViewLog.deleteMany({ where: { userId, topicId, topicVersion } });
  return true;
}

/**
 * Record that the read-and-understood declaration became visible to this trainee for this course
 * version. Called by the reading screen the first time it shows the tick box; stamped on every
 * current log so clearing the run (above) also clears the marker.
 */
export async function markAcknowledgementAvailable(userId: string, topicId: string) {
  const topic = await prisma.trainingTopic.findUnique({ where: { id: topicId } });
  if (!topic) throw AppError.notFound('Training course not found');
  const topicVersion = topic.currentVersion ?? 1;
  await prisma.materialViewLog.updateMany({
    where: { userId, topicId, topicVersion, ackAvailableAt: null },
    data: { ackAvailableAt: new Date() },
  });
  return { ok: true };
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
  // const { material, course, topicVersion } = await loadContext(materialId);
  // const requiredSeconds = requiredFor(material, course);
  // const totalPages = await pageTargetFor(material, course);
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
  // const { material, course, topicVersion } = await loadContext(materialId);
  const requiredSeconds = requiredFor(material, topic);
  // const totalPages = await pageTargetFor(material, course);

  // Create the log if the "start" call has not landed yet instead of rejecting. A material with
  // NO required reading time is completed ~1s after it opens, which can race the start request
  // on a slow connection — and a rejection there silently lost the file's completion, so it
  // showed as unread again on the next visit. Creating it here is safe: the elapsed-time check
  // below still runs against this fresh startedAt, so a TIMED material cannot be completed early.
  const log = await prisma.materialViewLog.upsert({
    where: { userId_materialId_topicVersion: { userId, materialId, topicVersion } },
    update: {},
    create: { userId, materialId, topicId: material.topicId, topicVersion, requiredSeconds },
  });
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
 * view log for this user + course version. Courses with no timed materials pass freely.
 // * True when every GATED material for this course version has a COMPLETED view log for this
 // * user. A material is gated when it has a required reading time OR requires page coverage,
 // * so a document with no timer still has to be read through to the last page. Courses whose
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
    // const gate = requiredFor(m, course as TopicLike) > 0 || (await pageTargetFor(m, course as TopicLike, resolve)) != null;
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
  // Opening the reading screen is the point at which a previous, finished-but-unacknowledged run
  // is discarded (see resetUnacknowledgedReading) — so the status below reflects the fresh start.
  await resetUnacknowledgedReading(userId, topicId).catch(() => undefined);
  const topic = await prisma.trainingTopic.findUnique({ where: { id: topicId } });
  // const course = (await prisma.trainingTopic.findUnique({ where: { id: topicId } })) as (TopicLike & { currentVersion?: number }) | null;
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
      // End-of-document gate for the acknowledgement. Non-paginating types (video/audio/image/
      // text) have no last page, so they are always considered satisfied.
      paginates: paginates(m.fileType),
      reachedLastPage: paginates(m.fileType) ? log?.reachedLastPage ?? false : true,
    };
  });
//
  // return Promise.all(
    // (materials as unknown as (MaterialLike & { originalFileName: string })[]).map(async (m) => {
      // const log = logByMat.get(m.id);
      // const totalPages = await pageTargetFor(m, course);
      // const pagesViewed = log?.pagesViewed ?? [];
      // return {
        // materialId: m.id,
        // originalFileName: m.originalFileName,
        // fileType: m.fileType,
        // requiredSeconds: requiredFor(m, course),
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
