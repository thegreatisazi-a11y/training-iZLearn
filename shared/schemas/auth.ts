import { z } from 'zod';
import { nonEmptyString } from './common';

export const loginSchema = z.object({
  windowsUsername: nonEmptyString,
  password: z.string().min(1, { message: 'Password is required' }),
  deviceInfo: z.string().optional(),
  /**
   * When an active session already exists on another device, the client re-sends
   * the login with this flag to terminate the previous session and continue
   * (single-session enforcement / browser-close recovery — UR-81..84).
   */
  terminateExisting: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: nonEmptyString,
});
export type RefreshInput = z.infer<typeof refreshSchema>;

/** Re-authenticate to release the inactivity lock (does not issue new tokens). */
export const unlockSchema = z.object({
  windowsUsername: nonEmptyString,
  password: nonEmptyString,
});
export type UnlockInput = z.infer<typeof unlockSchema>;

export const passwordPolicy = (minLength = 8) =>
  z
    .string()
    .min(minLength, { message: `Password must be at least ${minLength} characters` })
    .regex(/[A-Z]/, { message: 'Must contain an uppercase letter' })
    .regex(/[a-z]/, { message: 'Must contain a lowercase letter' })
    .regex(/[0-9]/, { message: 'Must contain a digit' })
    .regex(/[^A-Za-z0-9]/, { message: 'Must contain a special character' });

export const changePasswordSchema = z
  .object({
    currentPassword: nonEmptyString,
    newPassword: passwordPolicy(),
    confirmPassword: nonEmptyString,
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const setSignaturePasswordSchema = z
  .object({
    loginPassword: nonEmptyString,
    /**
     * Required only when the user already has a signature password set; the
     * backend enforces that conditionally (it cannot be expressed here without
     * knowing the user's current state). Always optional at the schema level.
     */
    oldSignaturePassword: z.string().optional(),
    signaturePassword: passwordPolicy(),
    confirmSignaturePassword: nonEmptyString,
  })
  .refine((d) => d.signaturePassword === d.confirmSignaturePassword, {
    message: 'New signature and confirm password must match',
    path: ['confirmSignaturePassword'],
  });
export type SetSignaturePasswordInput = z.infer<typeof setSignaturePasswordSchema>;
