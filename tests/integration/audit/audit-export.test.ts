/**
 * Phase 9 Unit 3: Audit Log Export Integration Tests.
 *
 * Validates:
 * 1. Append and query of audit logs
 * 2. Multi-tenant isolation (Workspace A export never sees Workspace B entries)
 * 3. Date range and action filtering
 * 4. Deep metadata secret sanitization
 * 5. Full CSV and JSON generation
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/db/prisma';
import { appendAuditLog } from '@/server/repositories/audit.repository';
import { exportAuditLogs } from '@/server/services/audit/audit-export.service';
import type { TenantContext } from '@/server/tenancy/context';
import { createWorkspaceFixture, resetDatabase } from '../fixtures';

describe('Phase 9 Unit 3: Audit Log Export Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('guarantees tenant isolation: export contains only entries for active workspace', async () => {
    const fixtureA = await createWorkspaceFixture({ name: 'Alpha Retail' });
    const fixtureB = await createWorkspaceFixture({ name: 'Beta Boutique' });

    // Populate audit logs for Workspace A
    await appendAuditLog(prisma, {
      workspaceId: fixtureA.workspaceId,
      actorUserId: fixtureA.ownerUserId,
      action: 'product.created',
      resourceType: 'Product',
      resourceId: 'prod-alpha-1',
      metadata: { name: 'Alpha Silk Kurti', price: 2500 },
    });

    await appendAuditLog(prisma, {
      workspaceId: fixtureA.workspaceId,
      actorUserId: fixtureA.ownerUserId,
      action: 'member.invited',
      resourceType: 'WorkspaceInvite',
      metadata: { email: 'invitee@alpha.com', role: 'AGENT' },
    });

    // Populate audit logs for Workspace B
    await appendAuditLog(prisma, {
      workspaceId: fixtureB.workspaceId,
      actorUserId: fixtureB.ownerUserId,
      action: 'order.created',
      resourceType: 'Order',
      resourceId: 'ord-beta-1',
      metadata: { totalMinor: 500000 },
    });

    // Export CSV from Workspace A
    const exportResultA = await exportAuditLogs(fixtureA.context, { format: 'csv' }, prisma);

    expect(exportResultA.rowCount).toBe(2);
    expect(exportResultA.content).toContain('product.created');
    expect(exportResultA.content).toContain('member.invited');
    expect(exportResultA.content).toContain('Alpha Silk Kurti');

    // Multi-tenant guarantee: NEVER contains Workspace B data
    expect(exportResultA.content).not.toContain('order.created');
    expect(exportResultA.content).not.toContain('ord-beta-1');
  });

  it('sanitizes secrets and credentials in metadata during export', async () => {
    const fixture = await createWorkspaceFixture();

    await appendAuditLog(prisma, {
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.ownerUserId,
      action: 'settings.whatsapp_connected',
      resourceType: 'WhatsAppAccount',
      metadata: {
        phoneNumberId: 'phone-12345',
        accessToken: 'EAAG123456SecretTokenValue',
        metaAppSecret: 'top-secret-app-secret',
        webhookVerifyToken: 'verify-token-secret',
        safeProperty: 'connected_successfully',
      },
    });

    const result = await exportAuditLogs(fixture.context, { format: 'json' }, prisma);
    const parsed = JSON.parse(result.content);

    expect(parsed).toHaveLength(1);
    const meta = parsed[0].metadata;

    expect(meta.safeProperty).toBe('connected_successfully');
    expect(meta.accessToken).toBe('[REDACTED]');
    expect(meta.metaAppSecret).toBe('[REDACTED]');
    expect(meta.webhookVerifyToken).toBe('[REDACTED]');

    // Raw content check
    expect(result.content).not.toContain('EAAG123456SecretTokenValue');
    expect(result.content).not.toContain('top-secret-app-secret');
  });

  it('filters audit logs by action and date boundaries', async () => {
    const fixture = await createWorkspaceFixture();
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60_000);

    // Insert entries
    await appendAuditLog(prisma, {
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.ownerUserId,
      action: 'inventory.adjusted',
      resourceType: 'InventoryItem',
      metadata: { delta: 10 },
    });

    await appendAuditLog(prisma, {
      workspaceId: fixture.workspaceId,
      actorUserId: fixture.ownerUserId,
      action: 'order.refunded',
      resourceType: 'Order',
      metadata: { amountMinor: 150000 },
    });

    // Filter by action: 'inventory.adjusted'
    const filteredResult = await exportAuditLogs(
      fixture.context,
      { action: 'inventory.adjusted', from: fiveDaysAgo },
      prisma,
    );

    expect(filteredResult.rowCount).toBe(1);
    expect(filteredResult.content).toContain('inventory.adjusted');
    expect(filteredResult.content).not.toContain('order.refunded');
  });
});
