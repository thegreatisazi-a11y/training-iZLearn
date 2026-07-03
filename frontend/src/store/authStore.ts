import { create } from 'zustand';
import { AxiosError } from 'axios';
import type { PermissionMatrix, PermissionAction, PermissionVerb } from '@izlearn/shared';
import { LEGACY_FALLBACK } from '@izlearn/shared';
import { api, tokenStore } from '../lib/axios';

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
  permissions: PermissionMatrix;
}

/** Thrown when an active session already exists (single-session enforcement). */
export class SessionConflictError extends Error {
  constructor(public deviceInfo: string) {
    super('An active session already exists.');
  }
}

interface AuthState {
  user: AuthUser | null;
  mustChangePassword: boolean;
  initializing: boolean;
  login: (windowsUsername: string, password: string, terminateExisting?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  loadMe: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
  hasPermission: (module: string, action: PermissionAction) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  mustChangePassword: false,
  initializing: true,

  async login(windowsUsername, password, terminateExisting = false) {
    try {
      const res = await api.post('/auth/login', { windowsUsername, password, terminateExisting, deviceInfo: navigator.userAgent });
      const { accessToken, refreshToken, user, mustChangePassword } = res.data.data;
      tokenStore.set(accessToken, refreshToken);
      set({ user, mustChangePassword });
    } catch (e) {
      const err = e as AxiosError<{ error?: { code?: string; details?: { deviceInfo?: string } } }>;
      if (err.response?.status === 409) {
        throw new SessionConflictError(err.response.data?.error?.details?.deviceInfo || 'another device');
      }
      throw e;
    }
  },

  async logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    tokenStore.clear();
    set({ user: null, mustChangePassword: false });
  },

  async loadMe() {
    if (!tokenStore.getAccess()) {
      set({ initializing: false });
      return;
    }
    try {
      const res = await api.get('/auth/me');
      set({ user: res.data.data, initializing: false });
    } catch {
      tokenStore.clear();
      set({ user: null, initializing: false });
    }
  },

  setUser: (user) => set({ user }),

  hasPermission(module, action) {
    const perms = get().user?.permissions as Record<string, Record<string, boolean>> | undefined;
    const m = perms?.[module];
    if (!m) return false;
    if (m[action] === true) return true;
    // Granular verb absent (older custom role) → fall back to its legacy equivalent.
    const fallback = LEGACY_FALLBACK[action as PermissionVerb];
    return fallback ? m[fallback] === true : false;
  },
}));
