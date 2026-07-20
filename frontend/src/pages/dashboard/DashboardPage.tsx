import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BookOpen, CheckCircle2, Clock, AlertTriangle, Ban, RefreshCw, Award, Users, ClipboardList, FileText, UserCog, ScrollText,
  Settings, GripVertical, Eye, EyeOff, RotateCcw,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';
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

interface WidgetDef {
  id: string;
  title: string;
  available: boolean;
  node: ReactNode;
}

/** Reorder-and-hide dialog for the dashboard's section-widgets. Drafts changes locally,
 *  then persists on Save. Drag a row to reorder; toggle the eye to show/hide. */
function CustomizeDialog({
  open,
  onClose,
  widgets,
  hidden,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  widgets: { id: string; title: string }[];
  hidden: string[];
  onSave: (p: { order: string[]; hidden: string[] }) => void;
  saving: boolean;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(new Set());
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setItems(widgets.map((w) => w.id));
      setHiddenSet(new Set(hidden));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleOf = (id: string) => widgets.find((w) => w.id === id)?.title ?? id;
  const move = (from: number, to: number) => {
    if (from === to || from == null) return;
    setItems((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };
  const toggle = (id: string) =>
    setHiddenSet((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="max-w-md"
      title="Customize dashboard"
      footer={
        <>
          <Button variant="outline" onClick={() => onSave({ order: [], hidden: [] })} disabled={saving}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ order: items, hidden: [...hiddenSet] })} disabled={saving}>
            {saving ? 'Saving…' : 'Save layout'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">Drag to reorder. Use the eye to show or hide a section. Your layout is saved to your account.</p>
      <ul className="space-y-2">
        {items.map((id, i) => {
          const isHidden = hiddenSet.has(id);
          return (
            <li
              key={id}
              draggable
              onDragStart={() => (dragFrom.current = i)}
              onDragEnter={() => setDragOver(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                move(dragFrom.current ?? i, i);
                dragFrom.current = null;
                setDragOver(null);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDragOver(null);
              }}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 ${dragOver === i ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white'} ${isHidden ? 'opacity-60' : ''}`}
            >
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-400" />
              <span className={`flex-1 text-sm ${isHidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{titleOf(id)}</span>
              <button
                type="button"
                onClick={() => toggle(id)}
                title={isHidden ? 'Show section' : 'Hide section'}
                aria-label={isHidden ? `Show ${titleOf(id)}` : `Hide ${titleOf(id)}`}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-primary"
              >
                {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.hasPermission);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: svc.dashboard.get });
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const saveMut = useMutation({
    mutationFn: (p: { order: string[]; hidden: string[] }) => svc.dashboard.savePreferences(p),
    onSuccess: () => {
      toast.success('Dashboard layout saved.');
      setCustomizeOpen(false);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (isLoading || !data) return <PageLoader />;
  const dash = data as unknown as {
    preferences?: { order?: string[]; hidden?: string[] } | null;
    me: Record<string, number>;
    team?: Record<string, number>;
    org?: Record<string, number>;
    announcements?: { id: string; title: string; content: string }[];
  };
  const me = dash.me ?? {};
  const team = dash.team;
  const org = dash.org;
  const announcements = dash.announcements ?? [];

  // The backend gates team/org into the payload (org needs dashboard:view_org), so trust
  // its presence — keeps the UI in lockstep with the server permission.
  const showTeam = !!team;
  const showOrg = !!org;
  const showCourseMgmt = showOrg && can('courseManagement', 'read');

  const section = (title: string, grid: ReactNode) => (
    <>
      <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">{title}</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">{grid}</div>
    </>
  );

  // The dashboard's section-widgets. Order/visibility are personalised (see prefs below).
  const widgets: WidgetDef[] = [
    {
      id: 'announcements',
      title: 'Announcements',
      available: announcements.length > 0,
      node: (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Announcements</h2>
          <div className="mb-6 space-y-3">
            {announcements.map((a) => (
              <Card key={a.id} className="border-l-4 border-l-primary">
                <CardContent>
                  <div className="font-medium text-slate-800">{a.title}</div>
                  <div className="prose-sm mt-1 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(a.content) }} />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ),
    },
    {
      id: 'my-training',
      title: 'My Training',
      available: true,
      node: section(
        'My Training',
        <>
          <Stat icon={Clock} label="Pending" value={me.pending ?? 0} tone="bg-amber-100 text-amber-700" to="/my-trainings" />
          <Stat icon={BookOpen} label="In Progress" value={me.inProgress ?? 0} tone="bg-blue-100 text-blue-700" to="/my-trainings" />
          <Stat icon={CheckCircle2} label="Completed" value={me.completed ?? 0} tone="bg-green-100 text-green-700" to="/my-trainings" />
          <Stat icon={AlertTriangle} label="Overdue" value={me.overdue ?? 0} tone="bg-red-100 text-red-700" to="/my-trainings" />
          <Stat icon={Ban} label="Blocked" value={me.blocked ?? 0} tone="bg-red-100 text-red-700" to="/my-trainings" />
          <Stat icon={RefreshCw} label="Refresher Due" value={me.refresherDue ?? 0} tone="bg-purple-100 text-purple-700" to="/my-trainings" />
          <Stat icon={Award} label="Certificates" value={me.certificates ?? 0} tone="bg-teal-100 text-teal-700" to="/certificates" />
        </>,
      ),
    },
    {
      id: 'my-records',
      title: 'My Records',
      available: true,
      node: section(
        'My Records',
        <>
          <Stat icon={FileText} label="My Job Description" value="View" tone="bg-slate-100 text-slate-700" to="/my-jd" />
          <Stat icon={ScrollText} label="My CV" value="View" tone="bg-slate-100 text-slate-700" to="/my-cv" />
        </>,
      ),
    },
    {
      id: 'my-team',
      title: 'My Team (Reporting Manager)',
      available: showTeam,
      node: section(
        'My Team (Reporting Manager)',
        <>
          <Stat icon={Users} label="Team Members" value={team?.teamSize ?? 0} tone="bg-slate-100 text-slate-700" to="/team" />
          <Stat icon={Clock} label="Team Pending" value={team?.pending ?? 0} tone="bg-amber-100 text-amber-700" to="/team" />
          <Stat icon={AlertTriangle} label="Team Overdue" value={team?.overdue ?? 0} tone="bg-red-100 text-red-700" to="/team" />
          <Stat icon={Ban} label="Team Blocked" value={team?.blocked ?? 0} tone="bg-red-100 text-red-700" to="/team" />
        </>,
      ),
    },
    {
      id: 'training-management',
      title: 'Training Management',
      available: showCourseMgmt,
      node: section(
        'Training Management',
        <>
          <Stat icon={BookOpen} label="Published Courses" value={org?.publishedTopics ?? 0} tone="bg-green-100 text-green-700" to="/topics" />
          <Stat icon={BookOpen} label="Draft Courses" value={org?.draftTopics ?? 0} tone="bg-amber-100 text-amber-700" to="/topics" />
          <Stat icon={BookOpen} label="Under Review" value={org?.underReviewTopics ?? 0} tone="bg-blue-100 text-blue-700" to="/topics" />
          <Stat icon={BookOpen} label="Archived Courses" value={org?.archivedTopics ?? 0} tone="bg-slate-100 text-slate-600" to="/topics" />
          <Stat icon={ClipboardList} label="Assigned Trainings" value={org?.assignedTrainings ?? 0} tone="bg-slate-100 text-slate-700" to="/topics" />
          <Stat icon={Clock} label="Pending Trainings" value={org?.pendingTrainings ?? 0} tone="bg-amber-100 text-amber-700" to="/topics" />
          <Stat icon={CheckCircle2} label="Completed Trainings" value={org?.completedTrainings ?? 0} tone="bg-green-100 text-green-700" to="/topics" />
        </>,
      ),
    },
    {
      id: 'organisation',
      title: 'Organisation',
      available: showOrg,
      node: section(
        'Organisation',
        <>
          <Stat icon={Users} label="Active Users" value={org?.activeUsers ?? 0} tone="bg-slate-100 text-slate-700" to="/users" />
          <Stat icon={BookOpen} label="Training Topics" value={org?.totalTopics ?? 0} tone="bg-slate-100 text-slate-700" to="/topics" />
          <Stat icon={UserCog} label="Pending User Requests" value={org?.pendingUserRequests ?? 0} tone="bg-amber-100 text-amber-700" to="/users/requests" />
          <Stat icon={AlertTriangle} label="Overdue Assignments" value={org?.overdueAssignments ?? 0} tone="bg-red-100 text-red-700" to="/reports" />
          <Stat icon={ClipboardList} label="Pending TNI" value={org?.pendingTNI ?? 0} tone="bg-amber-100 text-amber-700" to="/tni" />
          <Stat icon={FileText} label="JD Approvals" value={org?.pendingJDApprovals ?? 0} tone="bg-amber-100 text-amber-700" to="/job-descriptions" />
          <Stat icon={Ban} label="Blocked Assessments" value={org?.blockedAssessments ?? 0} tone="bg-red-100 text-red-700" to="/reports" />
          {can('auditTrail', 'read') && (
            <Stat icon={ScrollText} label="Audit Trail" value="View" tone="bg-slate-100 text-slate-700" to="/audit-trail" />
          )}
        </>,
      ),
    },
  ];

  // Apply the user's saved layout: only AVAILABLE widgets, ordered by their saved order
  // (unknown/new widgets fall to the end in their default order), skipping hidden ones.
  const available = widgets.filter((w) => w.available);
  const savedOrder = dash.preferences?.order ?? [];
  const hidden = dash.preferences?.hidden ?? [];
  const ordered = [...available].sort((a, b) => {
    const ia = savedOrder.indexOf(a.id);
    const ib = savedOrder.indexOf(b.id);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
  const visible = ordered.filter((w) => !hidden.includes(w.id));

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? ''}`}
        description={`Roles: ${user?.roleNames?.join(', ')}`}
        actions={
          <Button variant="outline" onClick={() => setCustomizeOpen(true)}>
            <Settings className="h-4 w-4" /> Customize
          </Button>
        }
      />

      {visible.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-slate-500">
            All dashboard sections are hidden. Use <span className="font-medium">Customize</span> to show them again.
          </CardContent>
        </Card>
      ) : (
        visible.map((w) => <div key={w.id}>{w.node}</div>)
      )}

      <CustomizeDialog
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        widgets={ordered.map((w) => ({ id: w.id, title: w.title }))}
        hidden={hidden}
        onSave={(p) => saveMut.mutate(p)}
        saving={saveMut.isPending}
      />
    </div>
  );
}
