import { create } from 'zustand';
import { AxiosError } from 'axios';
import type { PermissionMatrix, PermissionAction, PermissionVerb } from '@izlearn/shared';
import { LEGACY_FALLBACK } from '@izlearn/shared';
import { api, tokenStore, setRequestRoleContext } from '../lib/axios';
import { queryClient } from '../lib/queryClient';

export interface AuthUser {
  id: string;
  windowsUsername: string;
  fullName: string;
  employeeId: string;
  email?: string | null;
  locationId?: string;
  departmentId?: string;
  sessionId: string;
  roleIds: string[];
  roleNames: string[];
  activeRoleId: string;
  activeRoleName: string;
  roleContext: string;
  availableRoles: Array<{ id: string; name: string }>;
  permissions: PermissionMatrix;
}

/** Thrown when an active session already exists (single-session enforcement). */
export class SessionConflictError extends Error {
  constructor(public deviceInfo: string) {
    super('An active session already exists.');
  }
}

export class RoleSelectionRequiredError extends Error {
  constructor(public roles: Array<{ id: string; name: string }>) { super('Select a role to continue.'); }
}

interface AuthState {
  user: AuthUser | null;
  mustChangePassword: boolean;
  initializing: boolean;
  login: (windowsUsername: string, password: string, terminateExisting?: boolean, activeRoleId?: string) => Promise<void>;
  switchRole: (activeRoleId: string) => Promise<void>;
  logout: () => Promise<void>;
  loadMe: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
  hasPermission: (module: string, action: PermissionAction) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  mustChangePassword: false,
  initializing: true,

  async login(windowsUsername, password, terminateExisting = false, activeRoleId) {
    try {
      const res = await api.post('/auth/login', { windowsUsername, password, terminateExisting, activeRoleId, deviceInfo: navigator.userAgent });
      if (res.data.data.requiresRoleSelection) throw new RoleSelectionRequiredError(res.data.data.roles);
      const { accessToken, refreshToken, user, mustChangePassword } = res.data.data;
      queryClient.clear();
      tokenStore.set(accessToken, refreshToken, user.roleContext);
      setRequestRoleContext(user.roleContext);
      set({ user, mustChangePassword });
    } catch (e) {
      const err = e as AxiosError<{ error?: { code?: string; details?: { deviceInfo?: string } } }>;
      if (err.response?.status === 409 && err.response.data?.error?.code === 'SESSION_EXISTS') {
        throw new SessionConflictError(err.response.data?.error?.details?.deviceInfo || 'another device');
      }
      throw e;
    }
  },

  async switchRole(activeRoleId) {
    if (queryClient.isMutating()) throw new Error('Finish the current save before switching roles.');
    const res = await api.post('/auth/switch-role', { activeRoleId });
    await queryClient.cancelQueries();
    queryClient.clear();
    const { user, accessToken } = res.data.data;
    tokenStore.set(accessToken, undefined, user.roleContext);
    setRequestRoleContext(user.roleContext);
    set({ user });
  },

  async logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    tokenStore.clear();
    queryClient.clear();
    set({ user: null, mustChangePassword: false });
  },

  async loadMe() {
    if (!tokenStore.getAccess()) {
      set({ initializing: false });
      return;
    }
    try {
      let res;
      try { res = await api.get('/auth/me'); }
      catch (error) {
        const failure = error as AxiosError<{ error?: { code?: string } }>;
        if (![401, 409].includes(failure.response?.status ?? 0)) throw error;
        const refreshToken = tokenStore.getRefresh();
        if (!refreshToken) throw error;
        const refreshed = await api.post('/auth/refresh', { refreshToken });
        tokenStore.set(refreshed.data.data.accessToken, undefined, refreshed.data.data.roleContext);
        setRequestRoleContext(null);
        res = await api.get('/auth/me');
      }
      if (get().user?.roleContext !== res.data.data.roleContext) queryClient.clear();
      setRequestRoleContext(res.data.data.roleContext);
      set({ user: res.data.data, initializing: false });
    } catch {
      tokenStore.clear();
      queryClient.clear();
      set({ user: null, initializing: false });
    }
  },

  setUser: (user) => {
    if (!user || get().user?.id !== user.id || get().user?.roleContext !== user.roleContext) queryClient.clear();
    setRequestRoleContext(user?.roleContext ?? null);
    set({ user });
  },

  hasPermission(module, action) {
    const perms = get().user?.permissions as Record<string, Record<string, boolean>> | undefined;
    const m = perms?.[module];
    if (!m) return false;
    if (m[action] === true) return true;
    // S6: respect an EXPLICIT false (admin turned it off) — don't fall back to the derived
    // read/write. Fall back to the legacy equivalent ONLY when the verb is entirely absent
    // (a legacy role saved under the old 5-flag model).
    if (m[action] === false) return false;
    const fallback = LEGACY_FALLBACK[action as PermissionVerb];
    return fallback ? m[fallback] === true : false;
  },
}));
