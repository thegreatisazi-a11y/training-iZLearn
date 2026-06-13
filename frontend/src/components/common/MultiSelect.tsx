import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Clean, searchable multi-select: a search box, a scrollable checkbox list, and
 * removable chips for the current selection. Replaces the native <select multiple>
 * boxes across the app. Dependency-free and keyboard/click friendly.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  heightClass = 'max-h-48',
  emptyText = 'No options available',
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  heightClass?: string;
  emptyText?: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [options, q]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const selected = options.filter((o) => value.includes(o.value));

  // CR-2: one-click select-all / clear over the currently visible (filtered) options.
  const filteredValues = filtered.map((o) => o.value);
  const allFilteredSelected = filteredValues.length > 0 && filteredValues.every((v) => value.includes(v));
  const selectAll = () => onChange(Array.from(new Set([...value, ...filteredValues])));
  const clearAll = () => onChange(value.filter((v) => !filteredValues.includes(v)));

  return (
    <div className="rounded-md border border-slate-300 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1.5">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {value.length > 0 && (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{value.length} selected</span>
        )}
      </div>
      {filtered.length > 0 && (
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1 text-xs">
          <button type="button" className="font-medium text-primary hover:underline" onClick={allFilteredSelected ? clearAll : selectAll}>
            {allFilteredSelected ? 'Clear all' : 'Select all'}
            {q.trim() ? ' (filtered)' : ''}
          </button>
          {value.length > 0 && (
            <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => onChange([])}>
              Reset
            </button>
          )}
        </div>
      )}
      <div className={`overflow-y-auto ${heightClass}`}>
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-sm text-slate-400">{emptyText}</div>
        ) : (
          filtered.map((o) => {
            const on = value.includes(o.value);
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={on} onChange={() => toggle(o.value)} />
                <span className="flex-1 truncate">{o.label}</span>
                {on && <Check className="h-3.5 w-3.5 text-primary" />}
              </label>
            );
          })
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-slate-200 p-2">
          {selected.map((o) => (
            <span key={o.value} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
              {o.label}
              <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => toggle(o.value)} aria-label={`Remove ${o.label}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
