import { ShieldCheck } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

export interface SignatureRecord {
  id: string;
  userFullName: string;
  meaning: string;
  signedAt: string;
}

/** Inline display of an electronic signature (21 CFR Part 11 §11.50). */
export function SignatureBlock({ signatures }: { signatures: SignatureRecord[] }) {
  if (!signatures?.length) return null;
  return (
    <div className="space-y-1">
      {signatures.map((s) => (
        <div key={s.id} className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Signed by <strong>{s.userFullName}</strong> on {formatDateTime(s.signedAt)} — Meaning: <strong>{s.meaning}</strong>
        </div>
      ))}
    </div>
  );
}
