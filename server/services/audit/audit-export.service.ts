/**
 * Audit Log Export Service.
 *
 * Implements authorized, tenant-isolated export of audit log trails in
 * RFC 4180 CSV and structured JSON formats.
 *
 * Security Guarantees:
 * - Requires 'audit_log:export' permission (held by OWNER).
 * - Enforces hard tenant isolation: only rows belonging to context.workspaceId are retrieved.
 * - Deep sanitization of metadata: secrets, tokens, API keys, and sensitive authorization
 *   payloads are redacted before leaving the server.
 * - Upper-bounded export limit to prevent memory and CPU exhaustion.
 */

import 'server-only';

import { prisma, type Db } from '@/db/prisma';
import { serializeCsv } from '@/lib/csv';
import { listAuditLogs, type AuditLogFilter, type AuditLogRow } from '@/server/repositories/audit.repository';
import { requirePermission, type TenantContext } from '@/server/tenancy/context';
import type { ExportAuditLogInput } from '@/server/validation/audit';

export type ExportAuditLogResult = {
  filename: string;
  mimeType: string;
  content: string;
  rowCount: number;
};

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /auth/i,
  /bearer/i,
  /credit/i,
  /card/i,
  /cvv/i,
  /pin/i,
  /signature/i,
  /cookie/i,
  /private/i,
];

/**
 * Deeply sanitizes metadata dictionary to eliminate any leaked credentials.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;

  function sanitizeValue(key: string, val: unknown): unknown {
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      return '[REDACTED]';
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sanitizedObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        sanitizedObj[k] = sanitizeValue(k, v);
      }
      return sanitizedObj;
    }
    if (Array.isArray(val)) {
      return val.map((item, idx) => sanitizeValue(String(idx), item));
    }
    return val;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    result[key] = sanitizeValue(key, value);
  }
  return result;
}

/**
 * Exports audit logs for the caller's active workspace.
 */
export async function exportAuditLogs(
  context: TenantContext,
  params: ExportAuditLogInput = {},
  db: Db = prisma,
): Promise<ExportAuditLogResult> {
  requirePermission(context, 'audit_log:export');

  const format = params.format ?? 'csv';
  const limit = Math.min(Math.max(params.limit ?? 1000, 1), 5000);

  const filter: AuditLogFilter = {
    from: params.from,
    to: params.to,
    action: params.action,
    actorType: params.actorType,
    limit,
  };

  // Strictly tenant-scoped query
  const logs = await listAuditLogs(db, context.workspaceId, filter);

  const sanitizedRows: (AuditLogRow & { metadata: Record<string, unknown> | null })[] = logs.map((row) => ({
    ...row,
    metadata: sanitizeAuditMetadata(row.metadata),
  }));

  const dateSuffix = new Date().toISOString().split('T')[0];
  const filename = `audit_logs_${context.workspaceSlug}_${dateSuffix}.${format}`;

  if (format === 'json') {
    return {
      filename,
      mimeType: 'application/json',
      content: JSON.stringify(sanitizedRows, null, 2),
      rowCount: sanitizedRows.length,
    };
  }

  // Format as RFC 4180 CSV
  const headers = [
    'ID',
    'Timestamp',
    'Action',
    'Actor Type',
    'Actor User ID',
    'Actor Member ID',
    'Resource Type',
    'Resource ID',
    'IP Address',
    'User Agent',
    'Metadata',
  ];

  const rows = sanitizedRows.map((r) => [
    r.id,
    r.createdAt.toISOString(),
    r.action,
    r.actorType,
    r.actorUserId ?? '',
    r.actorMemberId ?? '',
    r.resourceType ?? '',
    r.resourceId ?? '',
    r.ipAddress ?? '',
    r.userAgent ?? '',
    r.metadata ? JSON.stringify(r.metadata) : '',
  ]);

  return {
    filename,
    mimeType: 'text/csv',
    content: serializeCsv(headers, rows),
    rowCount: sanitizedRows.length,
  };
}
