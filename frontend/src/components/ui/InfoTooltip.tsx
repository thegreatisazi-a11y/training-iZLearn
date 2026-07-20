import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * A small ⓘ affordance that reveals help text on BOTH hover and click (click "pins" it
 * open until you click away or press Esc), plus keyboard focus — so it works for mouse,
 * touch, and keyboard users, unlike a native `title` tooltip (hover-only, delayed).
 */
export function InfoTooltip({ text, className = '' }: { text: string; className?: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="inline-flex items-center text-slate-400 outline-none hover:text-primary focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-[calc(100%+4px)] z-30 w-56 max-w-[70vw] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs font-normal normal-case leading-snug text-slate-600 shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
