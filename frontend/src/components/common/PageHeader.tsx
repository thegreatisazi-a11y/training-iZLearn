import { ReactNode } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      {/* min-w-0 lets a long title/course name wrap (left-aligned) instead of distorting the
          row layout; break-words avoids overflow on very long unbroken names. */}
      <div className="min-w-0">
        <h1 className="break-words text-xl font-semibold text-slate-800">{title}</h1>
        {description && <p className="mt-0.5 break-words text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
