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

/**
 * True when the requester may act ORG-WIDE on a module rather than only on their own
 * direct reports — i.e. the module's `view_all` permission is granted in Roles & Access
 * Control.
 *
 * This replaces the hard-coded `roleNames.includes('SUPER_ADMIN')` checks that used to be
 * scattered through the services. Those were invisible in R&AC (so an admin role other
 * than SUPER_ADMIN silently got the direct-reportee treatment) and could not be granted
 * to a custom role without a code change. `view_all` is a real toggle, and because the
 * key starts with "view" it derives the legacy `read` flag automatically.
 *
 * Read EXACTLY: an absent key is false (`view_all` has no legacy fallback), so a role
 * that has never been granted it never gets org-wide scope by accident.
 */
export function hasOrgWideScope(perms: PermissionMatrix | undefined, module: string): boolean {
  return hasPermission(perms, module, 'view_all' as PermissionAction);
}

/** The ids of a user's direct reports (active, non-deleted). */
export async function directReportIds(supervisorId: string): Promise<string[]> {
  const reports = await prisma.user.findMany({
    where: { supervisorId, isDeleted: false },
    select: { id: true },
  });
  return reports.map((r) => r.id);
}
