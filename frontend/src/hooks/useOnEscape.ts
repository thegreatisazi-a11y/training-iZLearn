import { useEffect } from 'react';

/**
 * Close a bespoke overlay/drawer on the Escape key. For overlays that don't use the
 * shared Dialog (which already handles Esc). Only listens while `active` is true.
 */
export function useOnEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
