import { PERMISSION_CATALOG, type PermissionAction, type PermissionMatrix } from '@izlearn/shared';
import { hasPermission, mergePermissions } from './permissions';

const catalogActions = new Map(PERMISSION_CATALOG.map((module) => [
  module.module,
  new Set([...module.actions.map((action) => action.key),
    // Stored scheduling scope grants must stay comparable even before the scope UI is deployed.
    ...(module.module === 'scheduling' ? ['view_team', 'view_all'] : []),
    'read', 'write', 'approve', 'print', 'export']),
]));

/** Preserve legacy flags, but ignore retired modules/actions that no longer grant access. */
export function canGrantRolePermissions(
  actorPermissions: PermissionMatrix | undefined,
  requestedPermissions: Array<PermissionMatrix | null | undefined>,
): boolean {
  const requested = mergePermissions(requestedPermissions) as unknown as Record<string, Record<string, boolean>>;
  for (const [module, actions] of Object.entries(requested)) {
    const known = catalogActions.get(module);
    if (!known) continue;
    for (const [action, enabled] of Object.entries(actions)) {
      if (!known.has(action) || !enabled) continue;
      if (hasPermission(actorPermissions, module, action as PermissionAction)) continue;
      // schedulingScope gives view_all access to every team already. Older system
      // roles received view_all without the narrower view_team flag in migration.
      // Compare the effective scope, rather than requiring that redundant flag.
      if (module === 'scheduling' && action === 'view_team' && hasPermission(actorPermissions, module, 'view_all')) continue;
      return false;
    }
  }
  return true;
}

/** Notification recipients and approve/reject handlers share this exact decision policy. */
export function canDecideUserRequest(
  actorPermissions: PermissionMatrix | undefined,
  requestedPermissions: Array<PermissionMatrix | null | undefined>,
): boolean {
  return hasPermission(actorPermissions, 'userRequests', 'approve') &&
    canGrantRolePermissions(actorPermissions, requestedPermissions);
}
