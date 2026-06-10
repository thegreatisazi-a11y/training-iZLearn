import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useSessionStore } from '@/store/sessionStore';
import { Button } from '../ui/button';

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const lock = useSessionStore((s) => s.lock);
  const navigate = useNavigate();

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
      <div className="text-sm text-slate-500">Learning Management System</div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm font-medium text-slate-800">{user?.fullName}</div>
          <div className="text-xs text-slate-500">{user?.roleNames?.join(', ')}</div>
        </div>
        <Button variant="ghost" size="icon" title="Lock session" onClick={lock}>
          <Lock className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Log out"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
