import { prisma } from '../config/prisma';
import { parseExcel } from '../utils/excelExporter';
import { recordEvent } from './auditTrail.service';
import type { MarkAttendanceInput } from '@izlearn/shared';

export async function listAttendance(scheduleId: string) {
  const rows = await prisma.attendance.findMany({ where: { scheduleId, isDeleted: false }, orderBy: { markedAt: 'desc' } });
  // Resolve userId → name/employee code so the UI shows names, not raw ids.
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, employeeId: true } })
    : [];
  const uMap = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({
    ...r,
    userFullName: uMap.get(r.userId)?.fullName ?? null,
    employeeId: uMap.get(r.userId)?.employeeId ?? null,
  }));
}

async function upsertAttendance(
  scheduleId: string,
  userId: string,
  status: 'PRESENT' | 'ABSENT',
  markedBy: string,
  method: 'MANUAL' | 'EXCEL_UPLOAD' | 'ONLINE_AUTO',
) {
  const existing = await prisma.attendance.findFirst({ where: { scheduleId, userId, isDeleted: false } });
  if (existing) {
    return prisma.attendance.update({ where: { id: existing.id }, data: { status, markedBy, method } });
  }
  return prisma.attendance.create({ data: { scheduleId, userId, status, markedBy, method, createdBy: markedBy } });
}

export async function markAttendance(input: MarkAttendanceInput, markedBy: string) {
  const results = [];
  for (const e of input.entries) {
    results.push(await upsertAttendance(input.scheduleId, e.userId, e.status, markedBy, 'MANUAL'));
  }
  return results;
}

/** Mark attendance automatically when an e-learning trainee completes content. */
export async function markOnlineAuto(scheduleId: string, userId: string, markedBy = 'SYSTEM') {
  return upsertAttendance(scheduleId, userId, 'PRESENT', markedBy, 'ONLINE_AUTO');
}

interface ExcelPreview {
  valid: Array<{ row: number; userId: string; employeeId: string; status: 'PRESENT' | 'ABSENT' }>;
  errors: Array<{ row: number; messages: string[] }>;
}

export async function previewAttendanceExcel(buffer: Buffer): Promise<ExcelPreview> {
  const rows = await parseExcel(buffer);
  const valid: ExcelPreview['valid'] = [];
  const errors: ExcelPreview['errors'] = [];
  for (const r of rows) {
    const rowNum = Number(r.__row) || 0;
    const employeeId = String(r.EmployeeID ?? r.employeeId ?? '').trim();
    const statusRaw = String(r.Status ?? r.status ?? '').trim().toUpperCase();
    const messages: string[] = [];
    if (!employeeId) messages.push('EmployeeID is required');
    if (!['PRESENT', 'ABSENT'].includes(statusRaw)) messages.push('Status must be PRESENT or ABSENT');
    const user = employeeId ? await prisma.user.findFirst({ where: { employeeId, isDeleted: false } }) : null;
    if (employeeId && !user) messages.push(`No user found for EmployeeID ${employeeId}`);
    if (messages.length || !user) errors.push({ row: rowNum, messages });
    else valid.push({ row: rowNum, userId: user.id, employeeId, status: statusRaw as 'PRESENT' | 'ABSENT' });
  }
  return { valid, errors };
}

export async function commitAttendanceExcel(scheduleId: string, buffer: Buffer, markedBy: string) {
  const preview = await previewAttendanceExcel(buffer);
  for (const v of preview.valid) {
    await upsertAttendance(scheduleId, v.userId, v.status, markedBy, 'EXCEL_UPLOAD');
  }
  await recordEvent({
    action: 'FILE_UPLOAD',
    entityType: 'Attendance',
    entityId: scheduleId,
    newValue: { committed: preview.valid.length, failed: preview.errors.length },
  });
  return { committed: preview.valid.length, failed: preview.errors.length, errors: preview.errors };
}
