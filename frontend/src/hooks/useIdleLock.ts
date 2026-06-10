import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useAuthStore } from '@/store/authStore';

/** Locks the screen after `timeoutMinutes` of inactivity (Module 1). */
export function useIdleLock(timeoutMinutes = 15) {
  const lock = useSessionStore((s) => s.lock);
  const locked = useSessionStore((s) => s.locked);
  const user = useAuthStore((s) => s.user);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!user || locked) return;
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => lock(), timeoutMinutes * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      window.clearTimeout(timer.current);
    };
  }, [user, locked, lock, timeoutMinutes]);
}
