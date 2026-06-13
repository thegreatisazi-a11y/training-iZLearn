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
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={go} disabled={loading || disabled}>
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
