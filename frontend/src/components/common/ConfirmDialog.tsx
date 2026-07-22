import { useState, type ReactNode } from 'react';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { apiError } from '@/lib/axios';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Please confirm',
  message,
  confirmLabel = 'Confirm',
  danger,
  disabled = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title?: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Gate the confirm button (e.g. until a required reason is entered). */
  disabled?: boolean;
  /** Extra content rendered above the message (e.g. a reason field). */
  children?: ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    setLoading(true);
    setError('');
    try {
      await onConfirm();
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
      // Enter-to-confirm: with a single-line Input as children, Enter submits; a Textarea keeps
      // Enter as newline (no accidental confirm); message-only dialogs are unaffected.
      onSubmit={() => { if (!loading && !disabled) go(); }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={loading || disabled}>
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}
