import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Clean, searchable multi-select: a search box and a scrollable checkbox list that shows
 * the current selection inline (ticks + an "N selected" badge). Replaces the native
 * <select multiple> boxes across the app. Dependency-free and keyboard/click friendly.
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
  // Show options alphabetically by label (case-insensitive).
  const sortedOptions = useMemo(() => [...options].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })), [options]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? sortedOptions.filter((o) => o.label.toLowerCase().includes(s)) : sortedOptions;
  }, [sortedOptions, q]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

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
    </div>
  );
}
