import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import type { PermissionMatrix, PermissionAction } from '@izlearn/shared';
import { getConfig } from './systemConfig.service';
import { queueEmail } from './email.service';
import { renderEmail, EmailType } from '../utils/emailTemplates';
import { baseLayout } from '../utils/emailTemplates/base';
import { getSetting } from './notificationSetting.service';
import { formatDate } from '../utils/dateUtils';

/** Replace {{var}} placeholders in a template string from the data map. */
function interpolate(tpl: string, data: Record<string, string | undefined>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => data[k] ?? '');
}

/**
 * High-level notification helpers (Module 10). Each resolves recipients and
 * enqueues templated emails. All are best-effort: failures are logged, never
 * thrown, so a notification problem can never block a GMP business operation.
 */

interface Recipient {
  id?: string;
  fullName: string;
  email: string;
}

async function org(): Promise<string> {
  return (await getConfig('org.name')) || 'izLearn';
}

async function userRecipient(userId: string): Promise<Recipient | null> {
  const u = await prisma.user.findFirst({ where: { id: userId, isDeleted: false } });
  if (!u || !u.email) return null;
  return { id: u.id, fullName: u.fullName, email: u.email };
}

async function usersWithPermission(module: string, action: PermissionAction): Promise<Recipient[]> {
  const roles = await prisma.role.findMany({ where: { isActive: true, isDeleted: false } });
  const roleIds = roles
    .filter((r) => {
      const m = (r.permissions as PermissionMatrix as Record<string, Record<string, boolean>>)[module];
      return m && m[action];
    })
    .map((r) => r.id);
  if (!roleIds.length) return [];
  const userRoles = await prisma.userRole.findMany({ where: { roleId: { in: roleIds }, isActive: true } });
  const userIds = Array.from(new Set(userRoles.map((ur) => ur.userId)));
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true, isDeleted: false } });
  return users.filter((u) => u.email).map((u) => ({ id: u.id, fullName: u.fullName, email: u.email as string }));
}

async function departmentHeads(departmentId: string): Promise<Recipient[]> {
  const all = await usersWithPermission('jobDescription', 'approve');
  if (!all.length || !departmentId) return all;
  const ids = all.map((r) => r.id!).filter(Boolean);
  const users = await prisma.user.findMany({ where: { id: { in: ids }, departmentId } });
  const allowed = new Set(users.map((u) => u.id));
  return all.filter((r) => r.id && allowed.has(r.id));
}

/** UR-42: Resolve the direct line manager (supervisor) for a user if set and has an email. */
async function supervisorRecipient(userId: string): Promise<Recipient | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, isDeleted: false }, select: { supervisorId: true } });
  if (!user?.supervisorId) return null;
  return userRecipient(user.supervisorId);
}

async function send(type: EmailType, recipient: Recipient | null, data: Record<string, string | undefined>) {
  if (!recipient) return;
  try {
    const orgName = await org();
    const full = { ...data, orgName, userName: data.userName ?? recipient.fullName };
    // Module 10: respect the admin-configured notification settings.
    const setting = await getSetting(type).catch(() => null);
    if (setting && setting.enabled === false) return; // disabled by admin — do not send.

    const def = renderEmail(type, orgName, full);
    // Subject/body overrides (with {{variable}} interpolation); fall back to defaults.
    const subject = setting?.subject ? interpolate(setting.subject, full) : def.subject;
    const html = setting?.bodyHtml
      ? baseLayout({ orgName, title: subject, bodyHtml: interpolate(setting.bodyHtml, full) })
      : def.html;
    await queueEmail({ userId: recipient.id, toEmail: recipient.email, type, subject, html });
  } catch (e) {
    logger.error(`Notification ${type} failed`, { e: (e as Error).message });
  }
}

async function topicInfo(topicId: string) {
  const t = await prisma.trainingTopic.findUnique({ where: { id: topicId } });
  return { title: t?.title ?? 'Training', code: t?.topicCode ?? '' };
}

// ---- Public notification API ------------------------------------------------

export async function notifyTrainingAssigned(userId: string, topicId: string, dueDate?: Date | null) {
  const r = await userRecipient(userId);
  const t = await topicInfo(topicId);
  const data = { topicTitle: t.title, topicCode: t.code, dueDate: dueDate ? formatDate(dueDate) : 'Not set' };
  await send('trainingAssigned', r, data);
  // UR-42: also notify the direct line manager / supervisor so they are aware of assigned trainings
  const supervisor = await supervisorRecipient(userId);
  if (supervisor && supervisor.email !== r?.email) {
    await send('trainingAssigned', supervisor, { ...data, userName: `${r?.fullName ?? ''} (your direct report)` });
  }
}

export async function notifyTrainingDue(userId: string, topicId: string, dueDate: Date) {
  const t = await topicInfo(topicId);
  const trainee = await userRecipient(userId);
  await send('trainingDue', trainee, { topicTitle: t.title, dueDate: formatDate(dueDate) });
  for (const r of [...(await usersWithPermission('scheduling', 'write')), ...(await departmentHeads((await prisma.user.findUnique({ where: { id: userId } }))?.departmentId ?? ''))]) {
    await send('trainingDue', r, { topicTitle: t.title, dueDate: formatDate(dueDate), userName: trainee?.fullName });
  }
}

export async function notifyTrainingOverdue(userId: string, topicId: string, dueDate: Date) {
  const t = await topicInfo(topicId);
  const trainee = await userRecipient(userId);
  await send('trainingOverdue', trainee, { topicTitle: t.title, dueDate: formatDate(dueDate) });
  for (const r of await usersWithPermission('scheduling', 'write')) {
    await send('trainingOverdue', r, { topicTitle: t.title, dueDate: formatDate(dueDate), userName: trainee?.fullName });
  }
  // UR-42: notify supervisor on overdue (high visibility)
  const supervisor = await supervisorRecipient(userId);
  if (supervisor && supervisor.email !== trainee?.email) {
    await send('trainingOverdue', supervisor, { topicTitle: t.title, dueDate: formatDate(dueDate), userName: `${trainee?.fullName ?? ''} (your direct report)` });
  }
}

/**
 * 7.5: notify everyone with an active assignment to a topic that the course has
 * been revised (and their supervisors, matching the trainingAssigned pattern).
 * Best-effort — never throws.
 */
export async function notifyCourseRevised(topicId: string, reason?: string | null) {
  try {
    const t = await topicInfo(topicId);
    const assignments = await prisma.trainingAssignment.findMany({
      where: { topicId, isDeleted: false, status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'COMPLETED'] } },
      select: { userId: true },
    });
    const userIds = Array.from(new Set(assignments.map((a) => a.userId)));
    for (const uid of userIds) {
      const r = await userRecipient(uid);
      const data = { topicTitle: t.title, topicCode: t.code, reason: reason ?? undefined };
      await send('courseRevised', r, data);
      const supervisor = await supervisorRecipient(uid);
      if (supervisor && supervisor.email !== r?.email) {
        await send('courseRevised', supervisor, { ...data, userName: `${r?.fullName ?? ''} (your direct report)` });
      }
    }
  } catch (e) {
    logger.error('notifyCourseRevised failed', { e: (e as Error).message });
  }
}

export async function notifyRefresherDue(userId: string, topicId: string, dueDate: Date) {
  const t = await topicInfo(topicId);
  const trainee = await userRecipient(userId);
  await send('refresherDue', trainee, { topicTitle: t.title, dueDate: formatDate(dueDate) });
  for (const r of await usersWithPermission('scheduling', 'write')) {
    await send('refresherDue', r, { topicTitle: t.title, dueDate: formatDate(dueDate), userName: trainee?.fullName });
  }
}

export async function notifyAssessmentBlocked(userId: string, topicId: string) {
  const t = await topicInfo(topicId);
  const trainee = await userRecipient(userId);
  await send('assessmentBlocked', trainee, { topicTitle: t.title });
  for (const r of await usersWithPermission('scheduling', 'write')) {
    await send('assessmentBlocked', r, { topicTitle: t.title, userName: trainee?.fullName });
  }
}

/** Notify the trainee's direct supervisor that a retake has been requested. */
export async function notifyRetakeRequested(traineeUserId: string, topicId: string, justification: string) {
  const t = await topicInfo(topicId);
  const supervisor = await supervisorRecipient(traineeUserId);
  const trainee = await userRecipient(traineeUserId);
  await send('retakeRequested', supervisor, { topicTitle: t.title, userName: trainee?.fullName, justification });
}

/** Notify the trainee of the supervisor's decision on their retake request. */
export async function notifyRetakeDecision(traineeUserId: string, topicId: string, approved: boolean, remarks?: string | null) {
  const t = await topicInfo(topicId);
  const trainee = await userRecipient(traineeUserId);
  await send('retakeDecision', trainee, { topicTitle: t.title, decision: approved ? 'approved' : 'rejected', remarks: remarks ?? undefined });
}

export async function notifyUserRequestSubmitted(fullName: string, employeeId: string, requestedBy: string) {
  for (const r of await usersWithPermission('userManagement', 'approve')) {
    await send('userRequestSubmitted', r, { fullName, employeeId, requestedBy });
  }
}

export async function notifyUserRequestDecision(
  userId: string | null,
  email: string | null,
  decision: string,
  remarks?: string,
  requestedByUserId?: string | null,
  tempPassword?: string,
) {
  // UR-90: notify the subject of the request (the user the request was generated for).
  // When userId is provided but has no email in DB (new user), fall back to the email on the request form.
  let r: Recipient | null = userId ? await userRecipient(userId) : null;
  if (!r && email) r = { fullName: 'User', email };
  await send('userRequestDecision', r, { decision, remarks, tempPassword });

  // UR-91: also notify the person who generated the request (esp. on rejection,
  // where there may be no subject account yet). Skip if it's the same mailbox.
  if (requestedByUserId) {
    const requestor = await userRecipient(requestedByUserId);
    if (requestor && requestor.email !== r?.email) {
      await send('userRequestDecision', requestor, { decision, remarks });
    }
  }
}

export async function notifyPasswordReset(userId: string, tempPassword: string) {
  const r = await userRecipient(userId);
  await send('passwordReset', r, { tempPassword });
}

export async function notifyJdPendingApproval(departmentId: string, title: string) {
  for (const r of await departmentHeads(departmentId)) {
    await send('jdPendingApproval', r, { title });
  }
}

export async function notifyJdDecision(userId: string, title: string, decision: string) {
  await send('jdDecision', await userRecipient(userId), { title, decision });
}

export async function notifySessionTerminated(userId: string, deviceInfo: string) {
  await send('sessionTerminated', await userRecipient(userId), { deviceInfo });
}

export async function notifyScheduleCreated(traineeIds: string[], topicId: string, scheduledDate: Date, venue?: string | null) {
  const t = await topicInfo(topicId);
  for (const id of traineeIds) {
    await send('scheduleCreated', await userRecipient(id), { topicTitle: t.title, scheduledDate: formatDate(scheduledDate), venue: venue ?? 'TBD' });
  }
}

export async function notifyAnnouncement(announcementId: string) {
  const a = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!a) return;
  const targetRoles = (a.targetRoles as string[]) ?? [];
  let users: Recipient[];
  if (!targetRoles.length) {
    const all = await prisma.user.findMany({ where: { isActive: true, isDeleted: false } });
    users = all.filter((u) => u.email).map((u) => ({ id: u.id, fullName: u.fullName, email: u.email as string }));
  } else {
    const userRoles = await prisma.userRole.findMany({ where: { roleId: { in: targetRoles }, isActive: true } });
    const ids = Array.from(new Set(userRoles.map((ur) => ur.userId)));
    const list = await prisma.user.findMany({ where: { id: { in: ids }, isActive: true, isDeleted: false } });
    users = list.filter((u) => u.email).map((u) => ({ id: u.id, fullName: u.fullName, email: u.email as string }));
  }
  for (const r of users) await send('announcement', r, { title: a.title, content: a.content });
}
