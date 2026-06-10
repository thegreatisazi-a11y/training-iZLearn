import { z } from 'zod';
import { nonEmptyString, uuid } from './common';
import { signatureMeaning } from './enums';

/**
 * Two-component electronic signature (21 CFR Part 11 §11.50 / §11.200).
 * Component 1: windowsUsername (identity). Component 2: signaturePassword
 * (separate from the login password). Both verified server-side.
 */
export const eSignatureSchema = z.object({
  windowsUsername: nonEmptyString,
  signaturePassword: nonEmptyString,
  meaning: signatureMeaning,
  recordType: nonEmptyString,
  recordId: nonEmptyString,
});
export type ESignatureInput = z.infer<typeof eSignatureSchema>;

/**
 * Many actions embed a signature alongside their payload. Compose this into
 * any request body that requires an e-signature to authorise the action.
 */
export const withSignature = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    signature: z.object({
      windowsUsername: nonEmptyString,
      signaturePassword: nonEmptyString,
      meaning: signatureMeaning,
    }),
  });

export const signatureRefSchema = z.object({
  id: uuid,
  userFullName: z.string(),
  meaning: signatureMeaning,
  signedAt: z.string(),
});
export type SignatureRef = z.infer<typeof signatureRefSchema>;
