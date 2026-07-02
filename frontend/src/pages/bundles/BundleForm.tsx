import { useQuery } from '@tanstack/react-query';
import { Input, Textarea, Field } from '@/components/ui/input';
import { MultiSelect } from '@/components/common/MultiSelect';
import { svc } from '@/services';

/** The editable shape of a bundle, shared by the create + edit dialogs. */
export interface BundleFormValue {
  name: string;
  description: string;
  topicIds: string[];
  departmentIds: string[];
  designationIds: string[];
  userIds: string[];
  dueDate: string; // yyyy-mm-dd ('' = none)
  isActive: boolean;
}

export const EMPTY_BUNDLE_FORM: BundleFormValue = {
  name: '',
  description: '',
  topicIds: [],
  departmentIds: [],
  designationIds: [],
  userIds: [],
  dueDate: '',
  isActive: true,
};

/**
 * Build the API payload from a form value. dueDate is sent only when set (the
 * backend coerces it to a Date and rejects ''); isActive/reasonForChange are
 * attached by the caller as needed (create vs edit).
 */
export function bundlePayload(v: BundleFormValue): Record<string, unknown> {
  return {
    name: v.name,
    description: v.description || undefined,
    topicIds: v.topicIds,
    departmentIds: v.departmentIds,
    designationIds: v.designationIds,
    userIds: v.userIds,
    dueDate: v.dueDate || undefined,
  };
}

/**
 * Shared bundle create/edit body. Targeting is by Department, Designation and
 * specific Users (role-based targeting stays supported by the API but is no
 * longer surfaced here). Every multi-select is searchable.
 */
export function BundleForm({
  value,
  onChange,
  showStatus = false,
}: {
  value: BundleFormValue;
  onChange: (v: BundleFormValue) => void;
  showStatus?: boolean;
}) {
  const topics = useQuery({ queryKey: ['topics', 'all'], queryFn: () => svc.topics.list({ pageSize: 200 }) });
  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => svc.departments.list({ pageSize: 200 }) });
  const designations = useQuery({ queryKey: ['designations', 'all'], queryFn: () => svc.master.listDesignations({ pageSize: 200 }) });
  const usersQ = useQuery({ queryKey: ['users', 'bundle-targets'], queryFn: () => svc.users.list({ pageSize: 500, includeInactive: false }) });

  const topicOpts = ((topics.data?.data ?? []) as unknown as { id: string; title: string; topicNumber?: string | null; topicCode: string }[]).map(
    (t) => ({ value: t.id, label: `${t.topicNumber || t.topicCode} — ${t.title}` }),
  );
  const deptOpts = ((departments.data?.data ?? []) as unknown as { id: string; name: string }[]).map((d) => ({ value: d.id, label: d.name }));
  const desigOpts = ((designations.data?.data ?? []) as unknown as { id: string; displayName: string }[]).map((d) => ({ value: d.id, label: d.displayName }));
  const userOpts = ((usersQ.data?.data ?? []) as unknown as { id: string; fullName: string; employeeId: string }[]).map(
    (u) => ({ value: u.id, label: `${u.fullName} (${u.employeeId})` }),
  );

  return (
    <>
      <Field label="Name" required>
        <Input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </Field>
      <Field label="Description">
        <Textarea value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} />
      </Field>
      <Field label="Topics (select one or more)">
        <MultiSelect options={topicOpts} value={value.topicIds} onChange={(topicIds) => onChange({ ...value, topicIds })} placeholder="Search topics…" heightClass="max-h-56" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Assign to Departments">
          <MultiSelect options={deptOpts} value={value.departmentIds} onChange={(departmentIds) => onChange({ ...value, departmentIds })} placeholder="Search departments…" />
        </Field>
        <Field label="Assign to Functional Role">
          <MultiSelect options={desigOpts} value={value.designationIds} onChange={(designationIds) => onChange({ ...value, designationIds })} placeholder="Search functional roles…" />
        </Field>
      </div>
      <Field label="Assign to specific Users (optional)">
        <MultiSelect options={userOpts} value={value.userIds} onChange={(userIds) => onChange({ ...value, userIds })} placeholder="Search users…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Default due date (optional)">
          <Input type="date" value={value.dueDate} onChange={(e) => onChange({ ...value, dueDate: e.target.value })} />
        </Field>
        {showStatus && (
          <Field label="Status">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={value.isActive} onChange={(e) => onChange({ ...value, isActive: e.target.checked })} />
              Active (inactive bundles are hidden from the default list and cannot be assigned)
            </label>
          </Field>
        )}
      </div>
    </>
  );
}
