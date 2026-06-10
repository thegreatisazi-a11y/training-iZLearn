import { ShieldAlert } from 'lucide-react';

export function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldAlert className="h-10 w-10 text-red-500" />
      <h1 className="text-xl font-semibold text-slate-800">Access Denied</h1>
      <p className="max-w-sm text-sm text-slate-500">
        You do not have permission to view this module. This access attempt has been recorded in the audit trail.
      </p>
    </div>
  );
}

export default ForbiddenPage;
