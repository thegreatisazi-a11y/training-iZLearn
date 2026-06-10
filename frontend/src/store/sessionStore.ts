import { create } from 'zustand';
import { api } from '../lib/axios';

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
    await api.post('/auth/unlock', { windowsUsername, password });
    set({ locked: false });
  },
}));
