import { useNavigate } from 'react-router-dom';
import { Lock, LogOut, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useSessionStore } from '@/store/sessionStore';
import { Button } from '../ui/button';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const lock = useSessionStore((s) => s.lock);
  const navigate = useNavigate();
  const switchRole = useAuthStore((s) => s.switchRole);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const alternatives = (user?.availableRoles ?? []).filter((role) => role.id !== user?.activeRoleId);

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
      <div className="text-sm text-slate-500">Learning Management System</div>
      <div className="flex items-center gap-4">
        <div className="relative text-right">
          <button type="button" className="text-right disabled:cursor-default" aria-label="Switch active role" aria-expanded={menuOpen} disabled={!alternatives.length || switching} onClick={() => setMenuOpen((open) => !open)}>
          <div className="text-sm font-medium text-slate-800">{user?.fullName}</div>
          <div className="flex items-center justify-end gap-1 text-xs text-slate-500">{switching ? 'Switching role…' : user?.activeRoleName || user?.roleNames?.join(', ')}{alternatives.length > 0 && <ChevronDown className="h-3 w-3" />}</div>
          </button>
          {menuOpen && <div className="absolute right-0 top-full z-50 mt-2 min-w-48 rounded border border-slate-200 bg-white p-1 shadow-lg" aria-label="Available roles">
            {alternatives.map((role) => <button key={role.id} type="button" disabled={switching} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50" onClick={async () => {
              setSwitching(true);
              try { await switchRole(role.id); setMenuOpen(false); navigate('/', { replace: true }); }
              catch (error) { toast.error(apiError(error)); }
              finally { setSwitching(false); }
            }}>{role.name}</button>)}
          </div>}
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
