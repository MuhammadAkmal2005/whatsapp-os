'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Check,
  X,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ActionApprovalRow } from '@/server/repositories/approval.repository';
import { approveApprovalAction, rejectApprovalAction } from '@/app/(app)/(workspace)/approvals/actions';

type ApprovalsListProps = {
  approvals: ActionApprovalRow[];
};

export function ApprovalsList({ approvals }: ApprovalsListProps) {
  const [activeRejectId, setActiveRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setErrorMessage(null);
    setOperatingId(id);
    startTransition(async () => {
      const result = await approveApprovalAction(id);
      setOperatingId(null);
      if (!result.success) {
        setErrorMessage(result.error ?? 'Failed to approve request');
      }
    });
  };

  const handleRejectConfirm = (id: string) => {
    if (!rejectReason.trim()) {
      setErrorMessage('Please provide a reason for rejecting this request');
      return;
    }
    setErrorMessage(null);
    setOperatingId(id);
    startTransition(async () => {
      const result = await rejectApprovalAction(id, rejectReason.trim());
      setOperatingId(null);
      setActiveRejectId(null);
      setRejectReason('');
      if (!result.success) {
        setErrorMessage(result.error ?? 'Failed to reject request');
      }
    });
  };

  if (approvals.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center p-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-sunken text-muted-foreground mb-4">
          <CheckCircle2 className="size-6 text-success" />
        </div>
        <h3 className="text-base font-semibold text-foreground">All caught up</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          No pending action approvals require your review. When the AI encounters a sensitive action, it will appear here.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive-surface p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="space-y-4">
        {approvals.map((approval) => {
          const isActing = isPending && operatingId === approval.id;
          const isRejecting = activeRejectId === approval.id;

          return (
            <Card key={approval.id} className="p-5 transition-shadow hover:shadow-subtle">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionTypeBadge actionType={approval.actionType} />
                    <StatusBadge status={approval.status} />
                    <span className="text-xs text-muted-foreground">
                      Requested {new Date(approval.createdAt).toLocaleDateString()} at{' '}
                      {new Date(approval.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {approval.contact && (
                      <span className="flex items-center gap-1.5 text-foreground font-medium">
                        <User className="size-3.5 text-muted-foreground" />
                        {approval.contact.name || approval.contact.phoneE164}
                      </span>
                    )}

                    {approval.targetEntityId && (
                      <span className="flex items-center gap-1.5">
                        <ShoppingBag className="size-3.5 text-muted-foreground" />
                        Target: {approval.targetEntityType} #{approval.targetEntityId.slice(0, 8)}
                      </span>
                    )}

                    {approval.conversationId && (
                      <Link
                        href="/conversations"
                        className="text-xs text-primary hover:underline"
                      >
                        View Conversation
                      </Link>
                    )}
                  </div>

                  {approval.reason && (
                    <div className="rounded-md bg-surface-sunken p-3 text-sm text-foreground">
                      <span className="font-medium text-xs text-muted-foreground block mb-0.5">
                        Customer / System Reason:
                      </span>
                      {approval.reason}
                    </div>
                  )}

                  {approval.decisionReason && (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Resolution Note:</span> {approval.decisionReason}
                    </div>
                  )}
                </div>

                {/* Actions for PENDING approvals */}
                {approval.status === 'PENDING' && (
                  <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
                    {!isRejecting ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isActing}
                          onClick={() => {
                            setActiveRejectId(approval.id);
                            setRejectReason('');
                          }}
                          className="text-destructive hover:bg-destructive-surface hover:text-destructive"
                        >
                          <X className="size-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={isActing}
                          onClick={() => handleApprove(approval.id)}
                        >
                          {isActing ? (
                            <Loader2 className="size-4 animate-spin mr-1" />
                          ) : (
                            <Check className="size-4 mr-1" />
                          )}
                          Approve
                        </Button>
                      </>
                    ) : (
                      <div className="flex flex-col gap-2 min-w-[240px]">
                        <input
                          type="text"
                          placeholder="Reason for rejection (required)..."
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setActiveRejectId(null)}
                            disabled={isActing}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleRejectConfirm(approval.id)}
                            disabled={isActing || !rejectReason.trim()}
                          >
                            {isActing ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                            Confirm Rejection
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ActionTypeBadge({ actionType }: { actionType: string }) {
  switch (actionType) {
    case 'ORDER_CANCEL':
      return (
        <span className="inline-flex items-center rounded-md bg-destructive-surface px-2 py-0.5 text-xs font-semibold text-destructive">
          Order Cancellation
        </span>
      );
    case 'ADDRESS_CHANGE':
      return (
        <span className="inline-flex items-center rounded-md bg-primary-surface px-2 py-0.5 text-xs font-semibold text-primary">
          Address Change
        </span>
      );
    case 'ORDER_MODIFY':
      return (
        <span className="inline-flex items-center rounded-md bg-info-surface px-2 py-0.5 text-xs font-semibold text-info">
          Order Modification
        </span>
      );
    case 'REFUND_REQUEST':
      return (
        <span className="inline-flex items-center rounded-md bg-warning-surface px-2 py-0.5 text-xs font-semibold text-warning">
          Refund Request
        </span>
      );
    case 'EXCEPTIONAL_DISCOUNT':
      return (
        <span className="inline-flex items-center rounded-md bg-warning-surface px-2 py-0.5 text-xs font-semibold text-warning">
          Exceptional Discount
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-foreground">
          {actionType.replace(/_/g, ' ')}
        </span>
      );
  }
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning">
          <Clock className="size-3" />
          Pending Review
        </span>
      );
    case 'APPROVED':
    case 'EXECUTED':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-success-surface px-2 py-0.5 text-xs font-medium text-success">
          <CheckCircle2 className="size-3" />
          {status === 'EXECUTED' ? 'Executed' : 'Approved'}
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted-foreground">
          <XCircle className="size-3" />
          Rejected
        </span>
      );
    case 'FAILED':
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-destructive-surface px-2 py-0.5 text-xs font-medium text-destructive">
          <AlertCircle className="size-3" />
          Failed / Stale
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {status}
        </span>
      );
  }
}
