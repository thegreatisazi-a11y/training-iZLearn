import { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, FileText, FileSpreadsheet, FileType, Printer } from 'lucide-react';
import { Button } from '../ui/button';

export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'print';

const META: Record<ExportFormat, { label: string; icon: typeof FileText }> = {
  csv: { label: 'CSV', icon: FileText },
  excel: { label: 'Excel', icon: FileSpreadsheet },
  pdf: { label: 'PDF', icon: FileType },
  print: { label: 'Print', icon: Printer },
};

/**
 * The single, app-wide export control: one "Export ▾" button with a dropdown of the
 * formats a screen supports (CSV / Excel / PDF / Print). Replaces the scattered mix of
 * standalone CSV/Excel/PDF/Print buttons so every module looks and behaves the same.
 *
 * Fully keyboard-accessible: opens on click, closes on Escape or outside click, and the
 * menu items are focusable/arrow-navigable buttons.
 */
export function ExportMenu({
  formats = ['csv', 'excel', 'pdf', 'print'],
  onSelect,
  disabled,
  busy,
  label = 'Export',
  align = 'right',
}: {
  formats?: ExportFormat[];
  onSelect: (format: ExportFormat) => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the first item so the menu is immediately keyboard-navigable.
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Arrow-key navigation within the open menu.
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={ref} className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-4 w-4" /> {busy ? 'Exporting…' : label} <ChevronDown className="h-4 w-4 opacity-60" />
      </Button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKey}
          className={`absolute z-30 mt-1 min-w-[9rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {formats.map((f) => {
            const { label: l, icon: Icon } = META[f];
            return (
              <button
                key={f}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSelect(f);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 outline-none hover:bg-slate-50 focus-visible:bg-slate-100"
              >
                <Icon className="h-4 w-4 text-slate-400" /> {l}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
