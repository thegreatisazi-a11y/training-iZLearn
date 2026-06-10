import { Request } from 'express';
import { prisma } from '../config/prisma';
import { comparePassword } from '../utils/passwordUtils';
import { AppError } from '../utils/response';
import { auditContext } from '../utils/auditContext';
import { recordEvent } from './auditTrail.service';
import type { SignatureMeaning } from '@izlearn/shared';

export interface SignInput {
  /** The currently authenticated user performing the signature. */
  actingUserId: string;
  /** Component 1 — re-entered identity. */
  windowsUsername: string;
  /** Component 2 — separate signature password. */
  signaturePassword: string;
  meaning: SignatureMeaning | string;
  recordType: string;
  recordId: string;
}

/**
 * 21 CFR Part 11 §11.50 / §11.200 — two-component electronic signature.
 * Both components (windowsUsername + signaturePassword) are verified
 * server-side against the signed-in user before an ElectronicSignature row is
 * created. The signature is permanently linked to the record; the signing event
 * is also recorded in the audit trail as ESIGN.
 */
export async function verifyAndSign(input: SignInput) {
  const user = await prisma.user.findFirst({
    where: { id: input.actingUserId, isDeleted: false, isActive: true },
  });
  if (!user) throw AppError.unauthorized('Signer account not found.');

  // Component 1: the re-entered username must match the authenticated user.
  if (user.windowsUsername.toLowerCase() !== input.windowsUsername.trim().toLowerCase()) {
    throw AppError.badRequest('The signature username does not match the signed-in user.');
  }

  // Component 2: the dedicated signature password (separate from login password).
  if (!user.signaturePasswordHash) {
    throw AppError.badRequest('No signature password is configured. Set one in your profile before signing.');
  }
  const ok = await comparePassword(input.signaturePassword, user.signaturePasswordHash);
  if (!ok) throw AppError.unauthorized('Invalid electronic-signature credentials.');

  const signature = await prisma.electronicSignature.create({
    data: {
      userId: user.id,
      userFullName: user.fullName,
      recordType: input.recordType,
      recordId: input.recordId,
      meaning: input.meaning,
      ipAddress: auditContext.getStore()?.ipAddress ?? null,
    },
  });

  await recordEvent({
    action: 'ESIGN',
    entityType: input.recordType,
    entityId: input.recordId,
    newValue: { meaning: input.meaning, signatureId: signature.id },
  });

  return signature;
}

/**
 * Helper for controllers: extract `req.body.signature` and sign on behalf of the
 * authenticated user. Returns the ElectronicSignature id to store as a FK.
 */
export async function signFromRequest(
  req: Request,
  recordType: string,
  recordId: string,
  fallbackMeaning: SignatureMeaning | string = 'Approved',
): Promise<string> {
  if (!req.user) throw AppError.unauthorized();
  const sig = (req.body?.signature ?? {}) as {
    windowsUsername?: string;
    signaturePassword?: string;
    meaning?: string;
  };
  if (!sig.windowsUsername || !sig.signaturePassword) {
    throw AppError.badRequest('An electronic signature (username + signature password) is required for this action.');
  }
  const signature = await verifyAndSign({
    actingUserId: req.user.id,
    windowsUsername: sig.windowsUsername,
    signaturePassword: sig.signaturePassword,
    meaning: sig.meaning || fallbackMeaning,
    recordType,
    recordId,
  });
  return signature.id;
}

export async function getSignaturesFor(recordType: string, recordId: string) {
  return prisma.electronicSignature.findMany({
    where: { recordType, recordId },
    orderBy: { signedAt: 'asc' },
  });
}
