import { NavLink } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { NAV } from '@/config/nav';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const items = NAV.filter((i) => !i.module || (user && (user.permissions as Record<string, Record<string, boolean>>)?.[i.module]?.[i.action ?? 'read']));

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 text-primary">
        <GraduationCap className="h-6 w-6" />
        <span className="text-lg font-bold">izLearn</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {items.map((i) => {
          const Icon = i.icon;
          return (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              className={({ isActive }) =>
                cn(
                  'mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {i.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
