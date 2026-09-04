import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
} from '@/server/services/notification/notification.service';
import * as notifRepo from '@/server/repositories/notification.repository';
import type { TenantContext } from '@/server/tenancy/context';

vi.mock('@/server/repositories/notification.repository', () => ({
  listNotifications: vi.fn(),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  countUnreadNotifications: vi.fn(),
  createNotification: vi.fn(),
}));

describe('Notification Service (Phase 6 Unit 2)', () => {
  const mockContext: TenantContext = {
    workspaceId: '11111111-1111-1111-1111-111111111111',
    workspaceSlug: 'test-ws',
    workspaceName: 'Test Workspace',
    role: 'ADMIN',
    membershipId: '22222222-2222-2222-2222-222222222222',
    sessionId: 'session-1234',
    currency: 'PKR',
    planKey: 'FREE',
    onboarding: { completedSteps: [], completedAt: null },
    requestId: 'req-1234',
    user: {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Test User',
      email: 'test@example.com',
      avatarUrl: null,
      emailVerifiedAt: new Date(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists notifications scoped to workspace and membership', async () => {
    const mockRows = [
      {
        id: 'n-1',
        workspaceId: mockContext.workspaceId,
        memberId: mockContext.membershipId,
        type: 'HUMAN_HANDOFF',
        level: 'WARNING',
        title: 'Handoff Alert',
        body: 'Customer requested assistance',
        createdAt: new Date(),
      },
    ];

    vi.mocked(notifRepo.listNotifications).mockResolvedValue(mockRows as any);

    const result = await listNotifications(mockContext, { limit: 10 });
    expect(result).toHaveLength(1);
    expect(notifRepo.listNotifications).toHaveBeenCalledWith(
      expect.anything(),
      mockContext.workspaceId,
      expect.objectContaining({
        memberId: mockContext.membershipId,
        limit: 10,
      }),
    );
  });

  it('marks a notification as read for the active member', async () => {
    vi.mocked(notifRepo.markNotificationAsRead).mockResolvedValue({ count: 1 } as any);

    await markNotificationAsRead(mockContext, 'n-1');
    expect(notifRepo.markNotificationAsRead).toHaveBeenCalledWith(
      expect.anything(),
      mockContext.workspaceId,
      'n-1',
      mockContext.membershipId,
    );
  });

  it('marks all notifications as read for the workspace member', async () => {
    vi.mocked(notifRepo.markAllNotificationsAsRead).mockResolvedValue({ count: 5 } as any);

    await markAllNotificationsAsRead(mockContext);
    expect(notifRepo.markAllNotificationsAsRead).toHaveBeenCalledWith(
      expect.anything(),
      mockContext.workspaceId,
      mockContext.membershipId,
    );
  });

  it('returns unread notification count', async () => {
    vi.mocked(notifRepo.countUnreadNotifications).mockResolvedValue(3);

    const count = await getUnreadNotificationCount(mockContext);
    expect(count).toBe(3);
    expect(notifRepo.countUnreadNotifications).toHaveBeenCalledWith(
      expect.anything(),
      mockContext.workspaceId,
      mockContext.membershipId,
    );
  });
});
