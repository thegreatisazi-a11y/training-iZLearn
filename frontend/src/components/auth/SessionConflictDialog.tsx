import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';

/** Single-session enforcement prompt (Module 1) — terminate the other device? */
export function SessionConflictDialog({
  open,
  deviceInfo,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  deviceInfo: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Active Session Detected"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Terminating…' : 'Terminate & Continue'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        An active session exists on device <strong>{deviceInfo}</strong>. Terminate it and continue signing in here?
      </p>
    </Dialog>
  );
}
