import { SelectHTMLAttributes, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

// Drop-in replacement for the old native <select>: same props (options / placeholder /
// value / disabled / className) and the same event-like onChange contract
// (`onChange={(e) => e.target.value}`), so no call site changes. The difference is the UI —
// a click-to-open popover with a type-to-filter search box, making every dropdown searchable.
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  placeholder?: string;
  /** Event-like for backward compatibility with the former native <select>. */
  onChange?: (e: { target: { value: string } }) => void;
}

// Only surface the filter box once a list is long enough to be worth filtering; short
// dropdowns (status filters, yes/no, etc.) stay clean with just the option list.
const SEARCH_MIN_OPTIONS = 5;

export function Select({ options, placeholder, className, value, onChange, disabled, id }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = value == null ? '' : String(value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setQ('');
      }
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === current) ?? null;
  const showSearch = options.length > SEARCH_MIN_OPTIONS;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s));
  }, [options, q]);

  function pick(v: string) {
    onChange?.({ target: { value: v } });
    setOpen(false);
    setQ('');
  }

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'iz-input flex w-full items-center justify-between text-left',
          disabled && 'cursor-not-allowed opacity-60',
        )}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className={cn('truncate', selected ? 'text-slate-800' : 'text-slate-400')}>
          {selected ? selected.label : placeholder ?? 'Select…'}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-slate-300 bg-white shadow-lg">
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1.5">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                autoFocus
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1" role="listbox">
            {/* Placeholder doubles as the "clear"/empty selection, matching the old native
                <option value="">{placeholder}</option>. */}
            {placeholder && (
              <button
                type="button"
                className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-slate-50"
                onClick={() => pick('')}
              >
                {placeholder}
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === current}
                  className={cn(
                    'block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-50',
                    o.value === current ? 'bg-primary/5 font-medium text-primary' : 'text-slate-700',
                  )}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
Select.displayName = 'Select';
