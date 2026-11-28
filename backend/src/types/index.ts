import type { PermissionMatrix } from '@izlearn/shared';

/** The authenticated principal attached to every request after auth.middleware. */
export interface AuthUser {
  id: string;
  windowsUsername: string;
  fullName: string;
  employeeId: string;
  email?: string | null;
  locationId: string; // UR-85: used for location-scoped data access
  departmentId: string; // used for department-scoped data access (Users list)
  sessionId: string;
  roleIds: string[];
  roleNames: string[];
  activeRoleId: string;
  activeRoleName: string;
  activeRoleIsSystem: boolean;
  roleContext: string;
  availableRoles: Array<{ id: string; name: string }>;
  /** Permissions of the selected role only. */
  permissions: PermissionMatrix;
}

export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
  rid: string;
  rc: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
}
