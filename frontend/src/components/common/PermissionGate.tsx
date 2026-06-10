import { ReactNode } from 'react';
import type { PermissionAction } from '@izlearn/shared';
import { useAuthStore } from '@/store/authStore';

/** Render children only if the current user has the required module+action. */
export function PermissionGate({ module, action, children }: { module: string; action: PermissionAction; children: ReactNode }) {
  const has = useAuthStore((s) => s.hasPermission(module, action));
  if (!has) return null;
  return <>{children}</>;
}
