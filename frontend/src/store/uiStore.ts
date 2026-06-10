import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface UIState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  remove: (id: number) => void;
}

let counter = 1;

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = counter++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useUIStore.getState().push('success', m),
  error: (m: string) => useUIStore.getState().push('error', m),
  info: (m: string) => useUIStore.getState().push('info', m),
};
