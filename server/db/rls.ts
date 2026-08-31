/**
 * PostgreSQL Row-Level Security (RLS) & Multi-Tenant Database Isolation Wrapper.
 *
 * Provides defense-in-depth database-level tenant isolation beneath
 * the repository and context assertion layers.
 *
 * Implements per-transaction session setting (`app.workspace_id`) and
 * idempotent SQL policy generation for PostgreSQL.
 */

import 'server-only';

import { prisma, type Db, type PrismaTransaction } from '@/db/prisma';
import { ValidationError } from '@/server/errors';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that the workspace id is a well-formed UUID before passing to SQL.
 */
export function validateWorkspaceId(workspaceId: string): string {
  if (!workspaceId || !UUID_REGEX.test(workspaceId)) {
    throw new ValidationError('Invalid workspaceId format for RLS context', {
      workspaceId: ['Must be a valid UUID'],
    });
  }
  return workspaceId.toLowerCase();
}

/**
 * All PostgreSQL tables in the schema that carry a non-nullable workspace_id column
 * and are governed by Row-Level Security.
 */
export const TENANT_SCOPED_TABLES = [
  'workspaces_members',
  'workspace_invites',
  'audit_logs',
  'rate_limit_buckets',
  'contacts',
  'contact_tags',
  'contact_custom_fields',
  'contact_timeline_events',
  'products',
  'product_variants',
  'inventory_items',
  'inventory_movements',
  'orders',
  'order_items',
  'order_timeline_events',
  'payments',
  'conversations',
  'conversation_participants',
  'messages',
  'message_attachments',
  'whatsapp_phone_numbers',
  'whatsapp_templates',
  'ai_agents',
  'ai_agent_instructions',
  'ai_turns',
  'knowledge_bases',
  'knowledge_documents',
  'knowledge_chunks',
  'automations',
  'automation_steps',
  'automation_runs',
  'automation_run_steps',
  'notifications',
  'analytics_daily',
  'usage_records',
  'subscriptions',
] as const;

export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number];

/**
 * Generates idempotent SQL statements to enable RLS and create workspace isolation policies
 * across all tenant-scoped tables.
 */
export function generateTenantRlsPoliciesSql(): string[] {
  const statements: string[] = [];

  for (const table of TENANT_SCOPED_TABLES) {
    // 1. Enable Row-Level Security
    statements.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    // 2. Drop existing policy if present for clean idempotent re-application
    statements.push(`DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${table}";`);
    // 3. Create tenant isolation policy checking session variable
    statements.push(
      `CREATE POLICY "tenant_isolation_policy" ON "${table}" USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);`,
    );
  }

  return statements;
}

/**
 * Runs an operation inside a PostgreSQL transaction with `app.workspace_id`
 * session variable set to the given workspace.
 */
export async function withTenantRls<T>(
  workspaceId: string,
  fn: (tx: PrismaTransaction) => Promise<T>,
  db: Db = prisma,
): Promise<T> {
  const validId = validateWorkspaceId(workspaceId);

  // If already inside a transaction, set the session setting and execute
  if ('$executeRawUnsafe' in db && !('$transaction' in db)) {
    const tx = db as PrismaTransaction;
    await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id', '${validId}', true);`);
    return fn(tx);
  }

  // Otherwise, start an interactive transaction
  return (db as typeof prisma).$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id', '${validId}', true);`);
    return fn(tx);
  });
}

/**
 * Asserts that the current database session variable `app.workspace_id` matches
 * the expected workspace ID.
 */
export async function getTenantSessionSetting(tx: PrismaTransaction): Promise<string | null> {
  const result = await tx.$queryRawUnsafe<Array<{ workspace_id: string | null }>>(
    `SELECT NULLIF(current_setting('app.workspace_id', true), '') AS workspace_id;`,
  );
  return result[0]?.workspace_id ?? null;
}
