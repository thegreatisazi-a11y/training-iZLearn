import type { PermissionMatrix } from '@izlearn/shared';

/** The authenticated principal attached to every request after auth.middleware. */
export interface AuthUser {
  id: string;
  windowsUsername: string;
  fullName: string;
  employeeId: string;
  email?: string | null;
  locationId: string; // UR-85: used for location-scoped data access
  sessionId: string;
  roleIds: string[];
  roleNames: string[];
  /** Union of the permission matrices of all the user's active roles. */
  permissions: PermissionMatrix;
}

export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
}
