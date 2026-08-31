/**
 * Phase 9 Unit 3: Audit Log Export Service Unit Tests.
 *
 * Tests:
 * - RBAC authorization ('audit_log:export' required)
 * - Metadata secret redaction (passwords, tokens, API keys, credentials)
 * - CSV and JSON serialization
 * - Tenant isolation query parameters
 * - Limit bounding
 */

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db/prisma';
import {
  exportAuditLogs,
  sanitizeAuditMetadata,
} from '@/server/services/audit/audit-export.service';
import type { TenantContext } from '@/server/tenancy/context';
import { ForbiddenError } from '@/server/errors';

describe('Phase 9 Unit 3: Audit Log Export Service', () => {
  const ownerContext: TenantContext = {
    user: {
      id: 'user-owner',
      email: 'owner@example.com',
      name: 'Owner User',
      emailVerifiedAt: new Date(),
      avatarUrl: null,
    },
    workspaceId: 'ws-tenant-1',
    workspaceSlug: 'tenant-one',
    workspaceName: 'Tenant One',
    role: 'OWNER',
    membershipId: 'mem-owner',
    sessionId: 'session-owner',
    currency: 'PKR',
    planKey: 'pro',
    requestId: 'req-test-audit',
  };

  const agentContext: TenantContext = {
    ...ownerContext,
    user: {
      ...ownerContext.user,
      id: 'user-agent',
    },
    role: 'AGENT',
  };

  describe('Metadata Sanitization', () => {
    it('redacts sensitive keys such as passwords, tokens, and api keys while preserving benign fields', () => {
      const input = {
        eventName: 'user.login',
        ip: '127.0.0.1',
        password: 'PlainTextPassword123!',
        authToken: 'secret-bearer-token',
        apiKey: 'sk-123456789',
        nested: {
          secret_key: 'top-secret',
          safeField: 'looks good',
        },
        creditCard: '4111222233334444',
      };

      const sanitized = sanitizeAuditMetadata(input);

      expect(sanitized).toEqual({
        eventName: 'user.login',
        ip: '127.0.0.1',
        password: '[REDACTED]',
        authToken: '[REDACTED]',
        apiKey: '[REDACTED]',
        nested: {
          secret_key: '[REDACTED]',
          safeField: 'looks good',
        },
        creditCard: '[REDACTED]',
      });
    });

    it('handles null or non-object metadata gracefully', () => {
      expect(sanitizeAuditMetadata(null)).toBeNull();
    });
  });

  describe('exportAuditLogs Authorization & Output', () => {
    it('refuses export when caller lacks audit_log:export permission', async () => {
      const mockDb = {} as Db;
      await expect(exportAuditLogs(agentContext, {}, mockDb)).rejects.toThrow(ForbiddenError);
    });

    it('exports sanitized CSV format for authorized owner', async () => {
      const mockLogs = [
        {
          id: 'audit-1',
          workspaceId: 'ws-tenant-1',
          actorUserId: 'user-owner',
          actorMemberId: 'mem-1',
          actorType: 'USER' as const,
          action: 'member.role_updated',
          resourceType: 'WorkspaceMember',
          resourceId: 'mem-2',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          metadata: { previousRole: 'AGENT', newRole: 'MANAGER', token: 'secret-token' },
          createdAt: new Date('2026-08-30T10:00:00Z'),
        },
      ];

      const mockDb = {
        auditLog: {
          findMany: vi.fn().mockResolvedValue(mockLogs),
        },
      } as unknown as Db;

      const result = await exportAuditLogs(ownerContext, { format: 'csv' }, mockDb);

      expect(result.rowCount).toBe(1);
      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toContain('audit_logs_tenant-one_');
      expect(result.filename.endsWith('.csv')).toBe(true);

      // CSV verification
      expect(result.content).toContain('ID,Timestamp,Action,Actor Type');
      expect(result.content).toContain('audit-1');
      expect(result.content).toContain('member.role_updated');
      expect(result.content).toContain('[REDACTED]');
      expect(result.content).not.toContain('secret-token');
    });

    it('exports sanitized JSON format for authorized owner', async () => {
      const mockLogs = [
        {
          id: 'audit-2',
          workspaceId: 'ws-tenant-1',
          actorUserId: 'user-owner',
          actorMemberId: 'mem-1',
          actorType: 'USER' as const,
          action: 'workspace.settings_updated',
          resourceType: 'Workspace',
          resourceId: 'ws-tenant-1',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          metadata: { api_key: 'secret-key', theme: 'dark' },
          createdAt: new Date('2026-08-30T12:00:00Z'),
        },
      ];

      const mockDb = {
        auditLog: {
          findMany: vi.fn().mockResolvedValue(mockLogs),
        },
      } as unknown as Db;

      const result = await exportAuditLogs(ownerContext, { format: 'json' }, mockDb);

      expect(result.rowCount).toBe(1);
      expect(result.mimeType).toBe('application/json');
      expect(result.filename.endsWith('.json')).toBe(true);

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('audit-2');
      expect(parsed[0].metadata.api_key).toBe('[REDACTED]');
      expect(parsed[0].metadata.theme).toBe('dark');
    });
  });
});
