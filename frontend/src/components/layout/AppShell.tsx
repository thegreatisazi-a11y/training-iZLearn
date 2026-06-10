import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Toaster } from '../common/Toaster';
import { InactivityLockOverlay } from '../auth/InactivityLockOverlay';
import { useIdleLock } from '@/hooks/useIdleLock';

export function AppShell() {
  useIdleLock(15);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
      <InactivityLockOverlay />
    </div>
  );
}
