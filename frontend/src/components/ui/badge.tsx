import { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  APPROVED: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  BLOCKED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-red-100 text-red-800',
  WAIVED: 'bg-slate-100 text-slate-700',
  DRAFT: 'bg-slate-100 text-slate-700',
  UNDER_REVIEW: 'bg-amber-100 text-amber-800',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  default: 'bg-slate-100 text-slate-700',
};

export function Badge({ tone, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: string }) {
  const cls = TONE[tone ?? String(children)] ?? TONE.default;
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', cls, className)} {...props}>
      {children}
    </span>
  );
}
