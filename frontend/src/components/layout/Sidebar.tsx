import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, GraduationCap } from 'lucide-react';
import { sidebarSections, type NavGroupId, type NavItem } from '@/config/nav';
import { APP_VERSION } from '@/config/app';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';

function matchesPath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

function SidebarLink({ item, nested = false }: { item: NavItem; nested?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => cn(
        'mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
        nested && 'ml-4',
        isActive ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  const sections = sidebarSections(user?.permissions as Record<string, Record<string, boolean>> | undefined);
  const [openGroups, setOpenGroups] = useState<Partial<Record<NavGroupId, boolean>>>({});

  // Opening a page through a bookmark or redirect reveals its place in the menu.
  useEffect(() => {
    const active = sections.find((section) => section.kind === 'group' && section.items.some((item) => matchesPath(pathname, item.to)));
    if (active?.kind === 'group') setOpenGroups((current) => ({ ...current, [active.id]: true }));
  }, [pathname, user?.permissions]);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 text-primary">
        <GraduationCap className="h-6 w-6" />
        <span className="text-lg font-bold">izLearn</span>
        <span className="self-end pb-0.5 text-xs font-normal text-slate-400">v{APP_VERSION}</span>
      </div>
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto p-2">
        {sections.map((section) => {
          if (section.kind === 'link') return <SidebarLink key={section.item.to} item={section.item} />;
          const Icon = section.icon;
          const active = section.items.some((item) => matchesPath(pathname, item.to));
          const expanded = openGroups[section.id] ?? active;
          return (
            <div key={section.id} className="mb-0.5">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`nav-${section.id}`}
                onClick={() => setOpenGroups((current) => ({ ...current, [section.id]: !expanded }))}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-slate-100',
                  active ? 'text-primary' : 'text-slate-600',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{section.label}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', expanded && 'rotate-180')} />
              </button>
              {expanded && <div id={`nav-${section.id}`}>{section.items.map((item) => <SidebarLink key={item.to} item={item} nested />)}</div>}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
