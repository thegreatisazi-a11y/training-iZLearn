import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

export interface SearchOption {
  value: string;
  label: string;
  sublabel?: string;
}

/**
 * Single-select dropdown with a search box and rich (label + sublabel) options.
 * Used for the Supervisor picker — clearly its own popover control (unlike the
 * always-open MultiSelect), so it never visually bleeds into adjacent fields.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyText = 'No matches',
  allowClear = true,
  heightClass = 'max-h-64',
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  heightClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
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

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s) || (o.sublabel ?? '').toLowerCase().includes(s));
  }, [options, q]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ('');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? 'text-slate-800' : 'text-slate-400'}>
          {selected ? selected.label : placeholder}
          {selected?.sublabel ? <span className="ml-1 text-xs text-slate-400">· {selected.sublabel}</span> : null}
        </span>
        <span className="flex items-center gap-1">
          {allowClear && selected && (
            <X
              className="h-4 w-4 text-slate-400 hover:text-slate-700"
              onClick={(e) => { e.stopPropagation(); pick(''); }}
            />
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-300 bg-white shadow-lg">
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
          <div className={`overflow-y-auto ${heightClass}`}>
            {allowClear && (
              <button type="button" className="block w-full px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50" onClick={() => pick('')}>
                — None —
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">{emptyText}</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${o.value === value ? 'bg-primary/5 font-medium text-primary' : 'text-slate-700'}`}
                  onClick={() => pick(o.value)}
                >
                  {o.label}
                  {o.sublabel ? <div className="text-xs text-slate-400">{o.sublabel}</div> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
