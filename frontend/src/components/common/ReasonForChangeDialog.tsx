import { useEffect, useState } from 'react';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea, Field } from '../ui/input';
import { apiError } from '@/lib/axios';

/** Captures the mandatory reason for change (21 CFR Part 11) for edits/deletes. */
export function ReasonForChangeDialog({
  open,
  onClose,
  onConfirm,
  title = 'Reason for Change',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  title?: string;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);

  async function submit() {
    if (reason.trim().length < 5) {
      setError('A reason of at least 5 characters is required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onConfirm(reason.trim());
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
          <Button onClick={submit} disabled={loading}>
            {loading ? 'Saving…' : 'Confirm'}
          </Button>
        </>
      }
    >
      <Field label="Reason for change (required)">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why this change is being made…" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}
