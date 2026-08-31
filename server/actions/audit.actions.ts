'use server';

/**
 * Audit Server Actions.
 *
 * Provides server-side actions for exporting workspace audit logs.
 */

import type { z } from 'zod';

import { formErrorFrom } from '@/server/actions/action-helpers';
import {
  exportAuditLogs,
  type ExportAuditLogResult,
} from '@/server/services/audit/audit-export.service';
import { requirePermission } from '@/server/tenancy/context';
import { requireTenantContext } from '@/server/tenancy/resolve';
import { exportAuditLogSchema } from '@/server/validation/audit';

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Exports audit log trails for the active workspace in CSV or JSON.
 * Requires OWNER role (holds 'audit_log:export').
 */
export async function exportAuditLogsAction(
  rawInput: z.input<typeof exportAuditLogSchema> = {},
): Promise<ActionResponse<ExportAuditLogResult>> {
  try {
    const context = await requireTenantContext();
    requirePermission(context, 'audit_log:export');

    const parsed = exportAuditLogSchema.parse(rawInput);
    const data = await exportAuditLogs(context, parsed);

    return { success: true, data };
  } catch (err) {
    const safe = formErrorFrom(err);
    return { success: false, error: safe.message ?? 'An unexpected error occurred.' };
  }
}
