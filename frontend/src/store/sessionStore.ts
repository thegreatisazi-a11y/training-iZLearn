import { create } from 'zustand';
import type { AxiosError } from 'axios';
import { api, tokenStore } from '../lib/axios';
import { useAuthStore } from './authStore';

export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please log in again.');
  }
}

interface SessionState {
  locked: boolean;
  lock: () => void;
  unlock: (windowsUsername: string, password: string) => Promise<void>;
  setLocked: (v: boolean) => void;
}

/**
 * Inactivity lock (Module 1). The screen locks after the configured idle
 * timeout; re-entering credentials unlocks WITHOUT a full logout.
 */
export const useSessionStore = create<SessionState>((set) => ({
  locked: false,
  lock: () => {
    set({ locked: true });
    api.post('/auth/lock').catch(() => undefined);
  },
  setLocked: (v) => set({ locked: v }),
  async unlock(windowsUsername, password) {
    const refreshToken = tokenStore.getRefresh();
    if (!refreshToken) {
      tokenStore.clear();
      useAuthStore.getState().setUser(null);
      set({ locked: false });
      throw new SessionExpiredError();
    }
    try {
      const res = await api.post('/auth/unlock', { refreshToken, windowsUsername, password });
      tokenStore.set(res.data.data.accessToken);
      set({ locked: false });
    } catch (error) {
      const code = (error as AxiosError<{ error?: { code?: string } }>).response?.data?.error?.code;
      if (code === 'SESSION_EXPIRED') {
        tokenStore.clear();
        useAuthStore.getState().setUser(null);
        set({ locked: false });
        throw new SessionExpiredError();
      }
      throw error;
    }
  },
}));
