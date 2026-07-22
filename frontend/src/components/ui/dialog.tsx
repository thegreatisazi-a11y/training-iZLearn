import { useEffect, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** When provided, the dialog body + footer are wrapped in a <form>, so pressing Enter in
   *  any field submits (call this to run the primary action). Give the primary footer button
   *  type="submit". Omit for dialogs with no single primary action. */
  onSubmit?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Autofocus the first field/control so the dialog is immediately keyboard-usable.
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]), textarea, select, [contenteditable=true]',
      );
      el?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;
  const Body = (
    <>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
    </>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={panelRef} className={cn('relative z-10 w-full max-w-lg rounded-lg bg-white shadow-xl', className)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
          {/* min-w-0 + break-words keep a long title (often a course name) left-aligned and
              wrapped instead of looking centered/clipped against the close button. */}
          <h3 className="min-w-0 break-words text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="-mr-1 mt-0.5 shrink-0 rounded p-1 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {onSubmit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {Body}
          </form>
        ) : (
          Body
        )}
      </div>
    </div>
  );
}
