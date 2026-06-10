import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONE = { success: 'border-green-200 bg-green-50 text-green-800', error: 'border-red-200 bg-red-50 text-red-800', info: 'border-slate-200 bg-white text-slate-800' };

export function Toaster() {
  const { toasts, remove } = useUIStore();
  return (
    <div className="fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm', TONE[t.kind])}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="opacity-60 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
