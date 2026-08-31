import { describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import {
  generateTenantRlsPoliciesSql,
  getTenantSessionSetting,
  TENANT_SCOPED_TABLES,
  validateWorkspaceId,
  withTenantRls,
} from '@/server/db/rls';
import { ValidationError } from '@/server/errors';

describe('Phase 9 Unit 1: PostgreSQL Row-Level Security (RLS) Architecture', () => {
  it('validates workspaceId format as valid UUID', () => {
    const validUuid = '12345678-1234-1234-1234-123456789abc';
    expect(validateWorkspaceId(validUuid)).toBe(validUuid);
    expect(validateWorkspaceId('12345678-1234-1234-1234-123456789ABC')).toBe(validUuid);

    expect(() => validateWorkspaceId('')).toThrow(ValidationError);
    expect(() => validateWorkspaceId('not-a-uuid')).toThrow(ValidationError);
    expect(() => validateWorkspaceId("'; DROP TABLE contacts; --")).toThrow(ValidationError);
  });

  it('generates complete RLS policy SQL statements for all tenant-scoped tables', () => {
    const sqlStatements = generateTenantRlsPoliciesSql();
    expect(sqlStatements.length).toBe(TENANT_SCOPED_TABLES.length * 3);

    for (const table of TENANT_SCOPED_TABLES) {
      expect(sqlStatements).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(sqlStatements).toContain(`DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${table}";`);
      expect(sqlStatements).toContain(
        `CREATE POLICY "tenant_isolation_policy" ON "${table}" USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);`,
      );
    }
  });

  it('withTenantRls sets app.workspace_id session setting within transaction', async () => {
    const targetWorkspaceId = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

    const sessionValue = await withTenantRls(targetWorkspaceId, async (tx) => {
      return getTenantSessionSetting(tx);
    });

    expect(sessionValue).toBe(targetWorkspaceId);
  });

  it('rejects invalid workspace id before executing transaction', async () => {
    await expect(
      withTenantRls('invalid-uuid', async (tx) => {
        return getTenantSessionSetting(tx);
      }),
    ).rejects.toThrow(ValidationError);
  });
});
