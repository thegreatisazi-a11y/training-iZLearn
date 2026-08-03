import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { svc } from '@/services';
import { toast } from '@/store/uiStore';
import { apiError } from '@/lib/axios';

const STATUS_TONE: Record<string, string> = { APPROVED: 'COMPLETED', REJECTED: 'REJECTED', SUBMITTED: 'IN_PROGRESS', DRAFT: 'PENDING' };
const statusLabel = (s?: string | null) =>
  s === 'SUBMITTED' ? 'Submitted — awaiting review' : s ? s.charAt(0) + s.slice(1).toLowerCase() : '';

/**
 * Shared CV review block (Option A): shows the CV's review status and, when it is SUBMITTED,
 * lets the supervisor Approve or Reject (with a required comment). Used on both the Team CVs
 * list and the My Team member profile so review works wherever the CV is opened, from one
 * code path. `onReviewed` lets the host refresh its own queries after a decision.
 */
export function CvReviewActions({
  userId,
  status,
  reviewComment,
  onReviewed,
}: {
  userId: string;
  status?: string | null;
  reviewComment?: string | null;
  onReviewed?: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');

  const reviewMut = useMutation({
    mutationFn: (vars: { decision: 'APPROVE' | 'REJECT'; comment?: string }) => svc.cv.review(userId, vars),
    onSuccess: (_res, vars) => {
      toast.success(vars.decision === 'APPROVE' ? 'CV approved.' : 'CV sent back to the employee.');
      setRejecting(false);
      setComment('');
      onReviewed?.();
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (!status) return null;

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Review status:</span>
        <Badge tone={STATUS_TONE[status] ?? 'default'}>{statusLabel(status)}</Badge>
        {status === 'REJECTED' && reviewComment && <span className="text-red-700">Comment: {reviewComment}</span>}
      </div>

      {status === 'SUBMITTED' && (
        <div className="mt-2">
          <p className="mb-2 text-sm text-slate-600">This CV has been submitted for your review.</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ decision: 'APPROVE' })}>
              Approve
            </Button>
            <Button size="sm" variant="danger" disabled={reviewMut.isPending} onClick={() => setRejecting((v) => !v)}>
              Reject
            </Button>
          </div>
          {rejecting && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
              <div className="mb-1 text-sm font-medium text-red-800">Reason for rejection (required)</div>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Explain what the employee needs to correct…" />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={reviewMut.isPending || comment.trim().length === 0}
                  onClick={() => reviewMut.mutate({ decision: 'REJECT', comment: comment.trim() })}
                >
                  Confirm rejection
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
