import { ReactNode } from 'react';
import type { PermissionAction } from '@izlearn/shared';
import { useAuthStore } from '@/store/authStore';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

export function PermissionRoute({ module, action = 'read', children }: { module: string; action?: PermissionAction; children: ReactNode }) {
  const has = useAuthStore((s) => s.hasPermission(module, action));
  if (!has) return <ForbiddenPage />;
  return <>{children}</>;
}
