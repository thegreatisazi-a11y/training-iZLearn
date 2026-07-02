import {
  Home, Users, Shield, MapPin, BookOpen, FolderOpen, FileText, ClipboardList,
  CalendarDays, CheckSquare, Award, MessageSquare, Megaphone, BarChart3, ScrollText, Settings, UserCircle, Stamp, GraduationCap, UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PermissionAction } from '@izlearn/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  module?: string;
  action?: PermissionAction;
}

/** Sidebar navigation. Items with a `module` are shown only if the user can read it. */
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/my-trainings', label: 'My Trainings', icon: GraduationCap },
  { to: '/my-jd', label: 'My Job Description', icon: FileText },
  { to: '/my-cv', label: 'My CV', icon: UserCircle },
  { to: '/team', label: 'My Team', icon: Users, module: 'team', action: 'read' },
  // Team CVs are now accessed inside a team member's profile (My Team → member → View CV),
  // so this top-level item is hidden. Kept (commented) so it can be restored if needed.
  // { to: '/team-cvs', label: 'Team CVs', icon: Users, module: 'team', action: 'read' },
  { to: '/users', label: 'Users', icon: Users, module: 'userManagement', action: 'read' },
  { to: '/users/requests', label: 'User Requests', icon: UserPlus, module: 'userManagement', action: 'read' },
  { to: '/roles', label: 'Roles & Access Control', icon: Shield, module: 'roleManagement', action: 'read' },
  { to: '/masters', label: 'Master Setup', icon: MapPin, module: 'masterSetup', action: 'read' },
  { to: '/topics', label: 'Courses', icon: BookOpen, module: 'courseManagement', action: 'read' },
  { to: '/materials', label: 'Material Library', icon: FolderOpen, module: 'materialManagement', action: 'read' },
  { to: '/job-descriptions', label: 'Job Descriptions', icon: FileText, module: 'jobDescription', action: 'read' },
  { to: '/tni', label: 'Training Needs (TNI)', icon: ClipboardList, module: 'tni', action: 'read' },
  { to: '/schedules', label: 'Scheduling', icon: CalendarDays, module: 'scheduling', action: 'read' },
  { to: '/assessments', label: 'Assessments', icon: CheckSquare, module: 'assessments', action: 'read' },
  { to: '/certificates', label: 'Certificates', icon: Award, module: 'certificates', action: 'read' },
  { to: '/admin/certificate-templates', label: 'Certificate Templates', icon: Stamp, module: 'certificates', action: 'write' },
  { to: '/feedback', label: 'Feedback', icon: MessageSquare, module: 'feedback', action: 'read' },
  { to: '/announcements', label: 'Announcements', icon: Megaphone, module: 'announcements', action: 'read' },
  { to: '/reports', label: 'Reports', icon: BarChart3, module: 'reports', action: 'read' },
  { to: '/audit-trail', label: 'Audit Trail', icon: ScrollText, module: 'auditTrail', action: 'read' },
  { to: '/system-config', label: 'System Config', icon: Settings, module: 'systemConfig', action: 'read' },
  { to: '/profile', label: 'My Profile', icon: UserCircle },
];
