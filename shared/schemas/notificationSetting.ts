import { z } from 'zod';
import { NOTIFICATION_TYPES } from './notificationCatalog';

/** Update a single notification's settings (enable + optional subject/body overrides). */
export const updateNotificationSettingSchema = z.object({
  enabled: z.boolean().optional(),
  /** Override subject; blank/undefined keeps the system default. May use {{variables}}. */
  subject: z.string().max(300).optional().nullable(),
  /** Override body HTML; blank/undefined keeps the system default. May use {{variables}}. */
  bodyHtml: z.string().max(20000).optional().nullable(),
});
export type UpdateNotificationSettingInput = z.infer<typeof updateNotificationSettingSchema>;

/** Runtime guard that a string is a known notification type. */
export function isNotificationType(v: string): boolean {
  return (NOTIFICATION_TYPES as readonly string[]).includes(v);
}
