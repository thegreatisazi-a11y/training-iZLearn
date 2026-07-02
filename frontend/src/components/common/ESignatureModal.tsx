import { useEffect, useState } from 'react';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input, Field, Textarea } from '../ui/input';
import { Select } from '../ui/select';
import { useAuthStore } from '@/store/authStore';
import { apiError } from '@/lib/axios';

export interface ESignaturePayload {
  windowsUsername: string;
  signaturePassword: string;
  meaning: string;
  /** Mandatory reason for change (≥5 chars) — only collected when requireReason is set. */
  reason?: string;
}

const MEANINGS = ['Approved', 'Reviewed', 'Rejected', 'Performed', 'Acknowledged'].map((m) => ({ value: m, label: m }));

/**
 * 21 CFR Part 11 §11.50 two-component electronic signature. The user must
 * re-enter their windowsUsername (component 1) AND signature password
 * (component 2). Paste is blocked, matching the login policy.
 */
export function ESignatureModal({
  open,
  onClose,
  onConfirm,
  title = 'Electronic Signature Required',
  defaultMeaning = 'Approved',
  requireReason = false,
  hideMeaning = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (sig: ESignaturePayload) => Promise<void>;
  title?: string;
  defaultMeaning?: string;
  /** When true, a mandatory "Reason for Change" (≥5 chars) is collected and returned. */
  requireReason?: boolean;
  /** B2: hide the Meaning dropdown and force `defaultMeaning` (e.g. acknowledge flow). */
  hideMeaning?: boolean;
}) {
  const expectedUser = useAuthStore((s) => s.user?.windowsUsername ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [meaning, setMeaning] = useState(defaultMeaning);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      // Pre-fill the username with the signed-in user (component 1 of the e-signature)
      // for convenience; it stays editable so a different signer can be entered.
      setUsername(expectedUser);
      setPassword('');
      setMeaning(defaultMeaning);
      setReason('');
      setConfirmed(false);
      setError('');
    }
  }, [open, defaultMeaning, expectedUser]);

  const reasonOk = !requireReason || reason.trim().length >= 5;
  const canSign = !!username && !!password && confirmed && reasonOk;

  async function submit() {
    setLoading(true);
    setError('');
    try {
      await onConfirm({ windowsUsername: username, signaturePassword: password, meaning, reason: reason.trim() });
      onClose();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={loading || !canSign}>
            {loading ? 'Signing…' : 'Sign'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Re-enter your credentials to apply your electronic signature. This action is permanently recorded.
      </p>
      <Field label="Username" required>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} placeholder={expectedUser ? `e.g. ${expectedUser}` : ''} />
      </Field>
      <Field label="Signature Password" required>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} />
      </Field>
      {!hideMeaning && (
        <Field label="Meaning">
          <Select options={MEANINGS} value={meaning} onChange={(e) => setMeaning(e.target.value)} />
        </Field>
      )}
      {requireReason && (
        <Field label="Reason for Change" required hint="Minimum 5 characters — required to enable Sign.">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this change being made? (minimum 5 characters)"
          />
        </Field>
      )}
      <label className="mt-1 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>I confirm that I am applying my electronic signature and that this action is attributable to me.</span>
      </label>
      {!canSign && !error && (
        <p className="mt-2 text-xs text-slate-400">
          To enable Sign: enter your username and signature password
          {requireReason ? ', provide a reason (≥5 characters)' : ''}, and tick the confirmation box above.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}
