'use server';

import { revalidatePath } from 'next/cache';
import { getTenantContext } from '@/server/tenancy/resolve';
import { approveRequest, rejectRequest } from '@/server/services/approval/approval.service';

export async function approveApprovalAction(
  approvalId: string,
  decisionReason?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await getTenantContext();
    if (!ctx) {
      return { success: false, error: 'Unauthorized' };
    }

    await approveRequest(ctx, approvalId, { decisionReason });
    revalidatePath('/approvals');
    revalidatePath('/dashboard');
    revalidatePath('/orders');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to approve request';
    return { success: false, error: errorMsg };
  }
}

export async function rejectApprovalAction(
  approvalId: string,
  decisionReason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await getTenantContext();
    if (!ctx) {
      return { success: false, error: 'Unauthorized' };
    }

    if (!decisionReason || !decisionReason.trim()) {
      return { success: false, error: 'A rejection reason is required' };
    }

    await rejectRequest(ctx, approvalId, { decisionReason: decisionReason.trim() });
    revalidatePath('/approvals');
    revalidatePath('/dashboard');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to reject request';
    return { success: false, error: errorMsg };
  }
}
