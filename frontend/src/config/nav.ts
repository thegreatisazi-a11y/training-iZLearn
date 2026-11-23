import {
  Home, Users, Shield, MapPin, BookOpen, FolderOpen, FileText, ClipboardList,
  CalendarDays, CheckSquare, Award, MessageSquare, Megaphone, BarChart3, ScrollText, Settings, UserCircle, Stamp, GraduationCap, UserPlus, Database,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PermissionAction } from '@izlearn/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  module?: string;
  action?: PermissionAction;
  group?: NavGroupId;
}

export type NavGroupId = 'myWork' | 'people' | 'training' | 'communication' | 'administration';

export const NAV_GROUPS: { id: NavGroupId; label: string; icon: LucideIcon }[] = [
  { id: 'myWork', label: 'My Documents', icon: UserCircle },
  { id: 'people', label: 'People & Team', icon: Users },
  { id: 'training', label: 'Training', icon: BookOpen },
  { id: 'communication', label: 'Communication', icon: MessageSquare },
  { id: 'administration', label: 'Administration & Oversight', icon: Shield },
];

/** Sidebar navigation. Items with a `module` are shown only if the user can read it. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/my-trainings', label: 'My Trainings', icon: GraduationCap },
  { to: '/my-jd', label: 'My Job Description', icon: FileText, group: 'myWork' },
  { to: '/my-cv', label: 'My CV', icon: UserCircle, group: 'myWork' },
  { to: '/team', label: 'My Team', icon: Users, module: 'team', action: 'read', group: 'people' },
  // Team CVs: supervisors review their reports' submitted CVs here (approve / send back).
  { to: '/team-cvs', label: 'Team CVs', icon: FileText, module: 'team', action: 'read', group: 'people' },
  { to: '/users', label: 'Users', icon: Users, module: 'userManagement', action: 'read', group: 'people' },
  { to: '/users/requests', label: 'User Requests', icon: UserPlus, module: 'userRequests', action: 'view', group: 'people' },
  { to: '/roles', label: 'Roles & Access Control', icon: Shield, module: 'roleManagement', action: 'read', group: 'administration' },
  { to: '/masters', label: 'Master Setup', icon: MapPin, module: 'masterSetup', action: 'read', group: 'administration' },
  { to: '/courses', label: 'Courses', icon: BookOpen, module: 'courseManagement', action: 'read', group: 'training' },
  { to: '/materials', label: 'Material Library', icon: FolderOpen, module: 'materialManagement', action: 'read', group: 'training' },
  { to: '/job-descriptions', label: 'Job Descriptions', icon: FileText, module: 'jobDescription', action: 'read', group: 'people' },
  { to: '/tni', label: 'Training Needs (TNI)', icon: ClipboardList, module: 'tni', action: 'read', group: 'training' },
  { to: '/schedules', label: 'Scheduling', icon: CalendarDays, module: 'scheduling', action: 'read', group: 'training' },
  { to: '/assessments', label: 'Assessments', icon: CheckSquare, module: 'assessments', action: 'read', group: 'training' },
  { to: '/certificates', label: 'Certificates', icon: Award, module: 'certificates', action: 'read', group: 'training' },
  { to: '/admin/certificate-templates', label: 'Certificate Templates', icon: Stamp, module: 'certificateTemplates', action: 'view', group: 'training' },
  { to: '/feedback', label: 'Feedback', icon: MessageSquare, module: 'feedback', action: 'read', group: 'communication' },
  { to: '/announcements', label: 'Announcements', icon: Megaphone, module: 'announcements', action: 'read', group: 'communication' },
  { to: '/reports', label: 'Reports', icon: BarChart3, module: 'reports', action: 'read', group: 'administration' },
  { to: '/audit-trail', label: 'Audit Trail', icon: ScrollText, module: 'auditTrail', action: 'read', group: 'administration' },
  { to: '/system-config', label: 'System Config', icon: Settings, module: 'systemConfig', action: 'read', group: 'administration' },
  { to: '/backups', label: 'Backup & Restore', icon: Database, module: 'backup', action: 'view', group: 'administration' },
  { to: '/profile', label: 'My Profile', icon: UserCircle },
];

export type NavSection = { kind: 'link'; item: NavItem } | { kind: 'group'; id: NavGroupId; label: string; icon: LucideIcon; items: NavItem[] };

/** Apply permissions first, then collapse groups with only one visible destination. */
export function sidebarSections(permissions?: Record<string, Record<string, boolean>>): NavSection[] {
  const visible = NAV.filter((item) => !item.module || permissions?.[item.module]?.[item.action ?? 'read']);
  const sections: NavSection[] = visible.filter((item) => !item.group && item.to !== '/profile').map((item) => ({ kind: 'link', item }));
  for (const group of NAV_GROUPS) {
    const items = visible.filter((item) => item.group === group.id);
    if (items.length === 1) sections.push({ kind: 'link', item: items[0] });
    else if (items.length > 1) sections.push({ kind: 'group', ...group, items });
  }
  const profile = visible.find((item) => item.to === '/profile');
  if (profile) sections.push({ kind: 'link', item: profile });
  return sections;
}
