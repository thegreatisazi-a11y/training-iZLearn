import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, Clock, AlertTriangle, Ban, RefreshCw, Award, Users, ClipboardList, FileText, UserCog, ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import DOMPurify from 'dompurify';

function Stat({ icon: Icon, label, value, tone, to }: { icon: typeof BookOpen; label: string; value: number | string; tone: string; to?: string }) {
  const body = (
    <Card className={to ? 'transition-shadow hover:shadow-md' : undefined}>
      <CardContent className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="text-2xl font-semibold text-slate-800">{value}</div>
          <div className="text-xs text-slate-500">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.hasPermission);
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: svc.dashboard.get });

  if (isLoading || !data) return <PageLoader />;
  const dash = data as unknown as {
    me: Record<string, number>;
    team?: Record<string, number>;
    org?: Record<string, number>;
    announcements?: { id: string; title: string; content: string }[];
  };
  const me = dash.me ?? {};
  const team = dash.team;
  const org = dash.org;
  const announcements = dash.announcements ?? [];

  const showTeam = team && can('team', 'read');
  const showOrg = org && (can('reports', 'read') || can('userManagement', 'read') || can('auditTrail', 'read'));
  const showCourseMgmt = showOrg && can('courseManagement', 'read');

  return (
    <div>
      <PageHeader title={`Welcome, ${user?.fullName ?? ''}`} description={`Roles: ${user?.roleNames?.join(', ')}`} />

      <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">My Training</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={Clock} label="Pending" value={me.pending ?? 0} tone="bg-amber-100 text-amber-700" to="/my-trainings" />
        <Stat icon={BookOpen} label="In Progress" value={me.inProgress ?? 0} tone="bg-blue-100 text-blue-700" to="/my-trainings" />
        <Stat icon={CheckCircle2} label="Completed" value={me.completed ?? 0} tone="bg-green-100 text-green-700" to="/my-trainings" />
        <Stat icon={AlertTriangle} label="Overdue" value={me.overdue ?? 0} tone="bg-red-100 text-red-700" to="/my-trainings" />
        <Stat icon={Ban} label="Blocked" value={me.blocked ?? 0} tone="bg-red-100 text-red-700" to="/my-trainings" />
        <Stat icon={RefreshCw} label="Refresher Due" value={me.refresherDue ?? 0} tone="bg-purple-100 text-purple-700" to="/my-trainings" />
        <Stat icon={Award} label="Certificates" value={me.certificates ?? 0} tone="bg-teal-100 text-teal-700" to="/certificates" />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">My Records</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={FileText} label="My Job Description" value="View" tone="bg-slate-100 text-slate-700" to="/my-jd" />
        <Stat icon={ScrollText} label="My CV" value="View" tone="bg-slate-100 text-slate-700" to="/my-cv" />
      </div>

      {showTeam && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">My Team (Reporting Manager)</h2>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat icon={Users} label="Team Members" value={team!.teamSize ?? 0} tone="bg-slate-100 text-slate-700" to="/team" />
            <Stat icon={Clock} label="Team Pending" value={team!.pending ?? 0} tone="bg-amber-100 text-amber-700" to="/team" />
            <Stat icon={AlertTriangle} label="Team Overdue" value={team!.overdue ?? 0} tone="bg-red-100 text-red-700" to="/team" />
            <Stat icon={Ban} label="Team Blocked" value={team!.blocked ?? 0} tone="bg-red-100 text-red-700" to="/team" />
          </div>
        </>
      )}

      {showCourseMgmt && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Training Management</h2>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat icon={BookOpen} label="Published Courses" value={org!.publishedTopics} tone="bg-green-100 text-green-700" to="/topics" />
            <Stat icon={BookOpen} label="Draft Courses" value={org!.draftTopics} tone="bg-amber-100 text-amber-700" to="/topics" />
            <Stat icon={BookOpen} label="Under Review" value={org!.underReviewTopics} tone="bg-blue-100 text-blue-700" to="/topics" />
            <Stat icon={BookOpen} label="Archived Courses" value={org!.archivedTopics} tone="bg-slate-100 text-slate-600" to="/topics" />
            <Stat icon={ClipboardList} label="Assigned Trainings" value={org!.assignedTrainings} tone="bg-slate-100 text-slate-700" to="/topics" />
            <Stat icon={Clock} label="Pending Trainings" value={org!.pendingTrainings} tone="bg-amber-100 text-amber-700" to="/topics" />
            <Stat icon={CheckCircle2} label="Completed Trainings" value={org!.completedTrainings} tone="bg-green-100 text-green-700" to="/topics" />
          </div>
        </>
      )}

      {showOrg && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Organisation</h2>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat icon={Users} label="Active Users" value={org!.activeUsers} tone="bg-slate-100 text-slate-700" to="/users" />
            <Stat icon={BookOpen} label="Training Topics" value={org!.totalTopics} tone="bg-slate-100 text-slate-700" to="/topics" />
            <Stat icon={UserCog} label="Pending User Requests" value={org!.pendingUserRequests} tone="bg-amber-100 text-amber-700" to="/users/requests" />
            <Stat icon={AlertTriangle} label="Overdue Assignments" value={org!.overdueAssignments} tone="bg-red-100 text-red-700" to="/reports" />
            <Stat icon={ClipboardList} label="Pending TNI" value={org!.pendingTNI} tone="bg-amber-100 text-amber-700" to="/tni" />
            <Stat icon={FileText} label="JD Approvals" value={org!.pendingJDApprovals} tone="bg-amber-100 text-amber-700" to="/job-descriptions" />
            <Stat icon={Ban} label="Blocked Assessments" value={org!.blockedAssessments} tone="bg-red-100 text-red-700" to="/reports" />
            {can('auditTrail', 'read') && (
              <Stat icon={ScrollText} label="Audit Trail" value="View" tone="bg-slate-100 text-slate-700" to="/audit-trail" />
            )}
          </div>
        </>
      )}

      {announcements.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Announcements</h2>
          <div className="space-y-3">
            {announcements.map((a: { id: string; title: string; content: string }) => (
              <Card key={a.id}>
                <CardContent>
                  <div className="font-medium text-slate-800">{a.title}</div>
                  <div className="prose-sm mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(a.content) }} />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
