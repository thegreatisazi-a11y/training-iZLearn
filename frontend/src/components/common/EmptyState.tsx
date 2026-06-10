import { Inbox } from 'lucide-react';

export function EmptyState({ message = 'No records found.' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
      <Inbox className="h-8 w-8" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
