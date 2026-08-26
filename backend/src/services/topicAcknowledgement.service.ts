// ============================================================================
// DISABLED — reading-gate / xlsx work, commented out on request (2026-08-06).
//
// Nothing imports this file, so it is inert. To re-enable, uncomment the whole
// file and restore the call sites (see the saved patch noted in the handover).
// ============================================================================
// import { prisma } from '../config/prisma';
// import { AppError } from '../utils/response';
// import { auditContext } from '../utils/auditContext';
// import { hasCompletedRequiredReading } from './materialView.service';
//
// /**
//  * The trainee's "read and understood" declaration for one course version.
//  *
//  * The statement is stored verbatim on every record rather than only referenced by id, so an
//  * audit years later can reconstruct exactly what the trainee agreed to even if the wording
//  * has since been changed. Records are write-once and scoped to the course version, so a
//  * course revision requires a fresh declaration (matching how re-training already works).
//  */
//
// /** The wording presented to the trainee. Persisted with each record — see above. */
// export const ACK_STATEMENT = 'I have read and understood the training contents.';
//
// /** Has this user acknowledged this exact course version? */
// export async function hasAcknowledged(userId: string, topicId: string, topicVersion: number): Promise<boolean> {
//   const row = await prisma.topicAcknowledgement.findUnique({
//     where: { userId_topicId_topicVersion: { userId, topicId, topicVersion } },
//   });
//   return !!row;
// }
//
// /**
//  * Record the declaration. Refuses until the reading controls (minimum time + full page
//  * coverage) are satisfied server-side, so the acknowledgement can never be submitted by a
//  * client that skipped the material — for example by posting straight to this endpoint.
//  *
//  * Idempotent: re-acknowledging the same course version returns the original record, keeping
//  * the first (earliest) declaration as the record of truth.
//  */
// export async function acknowledgeTopic(userId: string, topicId: string) {
//   const course = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
//   if (!course) throw AppError.notFound('Training course not found');
//   if (course.status !== 'PUBLISHED') {
//     throw AppError.conflict('This training is not currently published.');
//   }
//
//   const existing = await prisma.topicAcknowledgement.findUnique({
//     where: { userId_topicId_topicVersion: { userId, topicId, topicVersion: course.currentVersion } },
//   });
//   if (existing) return existing;
//
//   const readingDone = await hasCompletedRequiredReading(userId, topicId, course.currentVersion);
//   if (!readingDone) {
//     throw AppError.forbidden('Read every page of all training materials before confirming that you have read and understood them.');
//   }
//
//   // Attributability metadata comes from the per-request audit context (set by
//   // requestContextMiddleware), the same source the audit trail itself uses.
//   const ctx = auditContext.getStore();
//   return prisma.topicAcknowledgement.create({
//     data: {
//       userId,
//       topicId,
//       topicVersion: course.currentVersion,
//       statementText: ACK_STATEMENT,
//       ipAddress: ctx?.ipAddress ?? null,
//       userAgent: ctx?.userAgent ?? null,
//     },
//   });
// }
//
// /** Acknowledgement state for the current user + live course version (drives the UI gate). */
// export async function getAcknowledgementStatus(userId: string, topicId: string) {
//   const course = await prisma.trainingTopic.findFirst({ where: { id: topicId, isDeleted: false } });
//   if (!course) throw AppError.notFound('Training course not found');
//   const row = await prisma.topicAcknowledgement.findUnique({
//     where: { userId_topicId_topicVersion: { userId, topicId, topicVersion: course.currentVersion } },
//   });
//   return {
//     topicId,
//     topicVersion: course.currentVersion,
//     statementText: ACK_STATEMENT,
//     acknowledged: !!row,
//     acknowledgedAt: row?.acknowledgedAt ?? null,
//   };
// }

export {};
