import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createAutomationAction,
  updateAutomationAction,
  toggleAutomationAction,
  deleteAutomationAction,
  testTriggerAutomationAction,
} from '@/server/actions/automation.actions';
import * as automationService from '@/server/services/automation/automation.service';
import * as tenancyResolve from '@/server/tenancy/resolve';
import { NotFoundError, ForbiddenError } from '@/server/errors';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/server/tenancy/resolve', () => ({
  requireTenantContext: vi.fn(),
}));

vi.mock('@/server/services/automation/automation.service', () => ({
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  toggleAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  getAutomation: vi.fn(),
}));

vi.mock('@/server/services/automation/automation-engine.service', () => ({
  triggerAutomations: vi.fn().mockResolvedValue([{ automationId: 'auto-1', runId: 'run-1', status: 'COMPLETED' }]),
}));

vi.mock('@/db/prisma', () => ({
  prisma: {
    automation: {
      findFirst: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Automation Server Actions (Phase 6 Unit 2)', () => {
  const mockContext = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    workspaceSlug: 'test-ws',
    workspaceName: 'Test Workspace',
    role: 'ADMIN' as const,
    membershipId: '22222222-2222-2222-2222-222222222222',
    user: { id: '33333333-3333-3333-3333-333333333333', name: 'Test User', email: 'test@example.com' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tenancyResolve.requireTenantContext).mockResolvedValue(mockContext as any);
  });

  describe('createAutomationAction', () => {
    it('returns error when name is empty', async () => {
      const formData = new FormData();
      formData.set('name', '');
      formData.set('triggerType', 'MESSAGE_CONTAINS');
      formData.set('actions', JSON.stringify([{ position: 0, type: 'SEND_MESSAGE', config: { body: 'Hi' } }]));

      const result = await createAutomationAction({ status: 'idle' }, formData);
      expect(result.status).toBe('error');
      expect(result.fieldErrors?.name).toBeDefined();
    });

    it('returns error when actions array is empty', async () => {
      const formData = new FormData();
      formData.set('name', 'Valid Name');
      formData.set('triggerType', 'MESSAGE_CONTAINS');
      formData.set('actions', JSON.stringify([]));

      const result = await createAutomationAction({ status: 'idle' }, formData);
      expect(result.status).toBe('error');
      expect(result.fieldErrors?.actions).toBeDefined();
    });

    it('handles JSON payload parameter correctly', async () => {
      vi.mocked(automationService.createAutomation).mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
      } as any);

      const formData = new FormData();
      formData.set(
        'payload',
        JSON.stringify({
          name: 'JSON Created Automation',
          isActive: true,
          triggerType: 'MESSAGE_CONTAINS',
          triggerConfig: { keywords: ['help'], matchMode: 'ANY' },
          actions: [{ position: 0, type: 'SEND_MESSAGE', config: { body: 'Hello' } }],
        }),
      );

      await expect(
        createAutomationAction({ status: 'idle' }, formData),
      ).rejects.toThrow('NEXT_REDIRECT');

      expect(automationService.createAutomation).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({
          name: 'JSON Created Automation',
          isActive: true,
          triggerType: 'MESSAGE_CONTAINS',
        }),
      );
    });
  });

  describe('updateAutomationAction', () => {
    it('returns error for invalid UUID', async () => {
      const formData = new FormData();
      formData.set('name', 'Updated Name');

      const result = await updateAutomationAction('invalid-id', { status: 'idle' }, formData);
      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid automation ID');
    });

    it('updates automation and returns success', async () => {
      const autoId = '44444444-4444-4444-4444-444444444444';
      vi.mocked(automationService.updateAutomation).mockResolvedValue({
        id: autoId,
        name: 'New Name',
      } as any);

      const formData = new FormData();
      formData.set('name', 'New Name');
      formData.set('triggerType', 'MESSAGE_CONTAINS');

      const result = await updateAutomationAction(autoId, { status: 'idle' }, formData);
      expect(result.status).toBe('success');
      expect(automationService.updateAutomation).toHaveBeenCalledWith(
        mockContext,
        autoId,
        expect.objectContaining({ name: 'New Name' }),
      );
    });
  });

  describe('toggleAutomationAction', () => {
    it('toggles automation active state successfully', async () => {
      const autoId = '44444444-4444-4444-4444-444444444444';
      vi.mocked(automationService.toggleAutomation).mockResolvedValue({
        id: autoId,
        isActive: true,
      } as any);

      const result = await toggleAutomationAction(autoId, true);
      expect(result.status).toBe('success');
      expect(result.message).toContain('activated');
      expect(automationService.toggleAutomation).toHaveBeenCalledWith(mockContext, autoId, true);
    });
  });

  describe('deleteAutomationAction', () => {
    it('calls delete service and redirects', async () => {
      const autoId = '44444444-4444-4444-4444-444444444444';
      vi.mocked(automationService.deleteAutomation).mockResolvedValue(undefined as any);

      await expect(deleteAutomationAction(autoId)).rejects.toThrow('NEXT_REDIRECT');
      expect(automationService.deleteAutomation).toHaveBeenCalledWith(mockContext, autoId);
    });

    it('converts ForbiddenError into safe error FormState', async () => {
      const autoId = '44444444-4444-4444-4444-444444444444';
      vi.mocked(automationService.deleteAutomation).mockRejectedValue(new ForbiddenError());

      const result = await deleteAutomationAction(autoId);
      expect(result.status).toBe('error');
    });
  });
});
