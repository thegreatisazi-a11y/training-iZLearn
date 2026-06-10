import { ReactNode, useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';

/** Section 7 — izLearn is desktop/tablet only. Block viewports under 768px. */
export function ViewportGuard({ children }: { children: ReactNode }) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (narrow) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-900 p-8 text-center text-white">
        <Monitor className="h-12 w-12" />
        <h1 className="text-lg font-semibold">izLearn is designed for desktop and tablet use</h1>
        <p className="max-w-sm text-sm text-slate-300">Please switch to a larger screen (minimum 768px wide) to continue.</p>
      </div>
    );
  }
  return <>{children}</>;
}
