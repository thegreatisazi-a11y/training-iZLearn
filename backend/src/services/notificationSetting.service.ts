import { prisma } from '../config/prisma';
import { NOTIFICATION_CATALOG, type UpdateNotificationSettingInput } from '@izlearn/shared';

/**
 * Module 10: per-notification settings (enable/disable + subject/body overrides).
 * The catalog defines every notification; a NotificationSetting row overrides the
 * default. listSettings merges the two so the UI always shows the full catalogue.
 */

export interface ResolvedNotificationSetting {
  type: string;
  module: string;
  moduleLabel: string;
  label: string;
  description: string;
  defaultSubject: string;
  variables: string[];
  enabled: boolean;
  subject: string | null;
  bodyHtml: string | null;
  updatedAt?: Date | null;
}

/** Full catalogue merged with any stored overrides (defaults: enabled, no override). */
export async function listSettings(): Promise<ResolvedNotificationSetting[]> {
  const rows = await prisma.notificationSetting.findMany();
  const byType = new Map(rows.map((r) => [r.emailType, r]));
  return NOTIFICATION_CATALOG.map((def) => {
    const row = byType.get(def.type);
    return {
      type: def.type,
      module: def.module,
      moduleLabel: def.moduleLabel,
      label: def.label,
      description: def.description,
      defaultSubject: def.defaultSubject,
      variables: def.variables,
      enabled: row?.enabled ?? true,
      subject: row?.subject ?? null,
      bodyHtml: row?.bodyHtml ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/** Upsert one notification's settings. */
export async function updateSetting(emailType: string, input: UpdateNotificationSettingInput, updatedBy: string) {
  const data = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.subject !== undefined ? { subject: input.subject?.trim() || null } : {}),
    ...(input.bodyHtml !== undefined ? { bodyHtml: input.bodyHtml?.trim() || null } : {}),
    updatedBy,
  };
  return prisma.notificationSetting.upsert({
    where: { emailType },
    update: data,
    create: { emailType, enabled: input.enabled ?? true, subject: input.subject?.trim() || null, bodyHtml: input.bodyHtml?.trim() || null, updatedBy },
  });
}

/** Lightweight lookup used by the notification dispatcher (null = system default). */
export async function getSetting(emailType: string) {
  return prisma.notificationSetting.findUnique({ where: { emailType } });
}
