import type { PermissionMatrix, PermissionAction } from '@izlearn/shared';
import { prisma } from '../config/prisma';
import { hasPermission } from './permissions';

/**
 * Permission-driven access scoping — NO hard-coded role names.
 *
 * Authorization scope is derived entirely from the permission matrix that admins
 * configure in Roles & Access Control, plus the supervisor→report data relationship.
 * This means a brand-new custom role scopes correctly the moment its permissions are set,
 * with no code change: whoever holds an org-wide user-management permission acts org-wide;
 * whoever manages a team (has direct reports) but lacks it is limited to those reports.
 */

/**
 * True when the requester manages users org-wide (an administrator), as opposed to only
 * their own team. Keyed on the strong user-management verbs — edit / approve /
 * reset_password — which supervisors do not hold (they get view/print/export for the
 * read-only list and manage their people through the Team module instead).
 */
export function isOrgWideUserManager(perms?: PermissionMatrix): boolean {
  return (
    hasPermission(perms, 'userManagement', 'edit') ||
    hasPermission(perms, 'userManagement', 'approve') ||
    hasPermission(perms, 'userManagement', 'reset_password' as PermissionAction)
  );
}

/** The ids of a user's direct reports (active, non-deleted). */
export async function directReportIds(supervisorId: string): Promise<string[]> {
  const reports = await prisma.user.findMany({
    where: { supervisorId, isDeleted: false },
    select: { id: true },
  });
  return reports.map((r) => r.id);
}
