import { describe, expect, it } from 'vitest';

import type { WorkspaceRole } from '@/server/authz/permissions';
import {
  conversationCapability,
  conversationDetailCapability,
  conversationListCapability,
} from '@/server/services/conversation/conversation.capability';
import type { TenantContext } from '@/server/tenancy/context';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';

function contextFor(role: WorkspaceRole): TenantContext {
  return {
    user: {
      id: 'user-1',
      email: 'ahmed@akmalfashion.example',
      name: 'Ahmed Raza',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      avatarUrl: null,
    },
    workspaceId: WORKSPACE_A,
    workspaceSlug: 'akmal-fashion',
    workspaceName: 'Akmal Fashion',
    role,
    membershipId: 'membership-1',
    sessionId: 'session-1',
    currency: 'PKR',
    planKey: 'business',
    onboarding: { completedSteps: [], completedAt: null },
    requestId: 'request-1',
  };
}

const ALL_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const;

describe('what each role may do to a conversation', () => {
  it('lets an owner manage and reply to conversations', () => {
    const capability = conversationDetailCapability(contextFor('OWNER'));
    expect(capability).toEqual({
      reply: true,
      assign: true,
      updateStatus: true,
      toggleAi: true,
      delete: true,
      sendTemplate: true,
    });
    expect(conversationListCapability(contextFor('OWNER'))).toEqual({
      create: true,
      readAll: true,
    });
  });

  it('lets an agent reply, change status, and toggle AI but not delete or read all', () => {
    const capability = conversationDetailCapability(contextFor('AGENT'));
    expect(capability).toEqual({
      reply: true,
      assign: false,
      updateStatus: true,
      toggleAi: true,
      delete: false,
      sendTemplate: false,
    });
    expect(conversationListCapability(contextFor('AGENT'))).toEqual({
      create: true,
      readAll: false,
    });
  });

  it('gives a viewer read-only access with readAll enabled but no mutations', () => {
    const capability = conversationDetailCapability(contextFor('VIEWER'));
    expect(capability).toEqual({
      reply: false,
      assign: false,
      updateStatus: false,
      toggleAi: false,
      delete: false,
      sendTemplate: false,
    });
    expect(conversationListCapability(contextFor('VIEWER'))).toEqual({
      create: false,
      readAll: true,
    });
  });

  it('answers for every role without throwing', () => {
    for (const role of ALL_ROLES) {
      expect(() => conversationCapability(contextFor(role))).not.toThrow();
      expect(() => conversationListCapability(contextFor(role))).not.toThrow();
      expect(() => conversationDetailCapability(contextFor(role))).not.toThrow();
    }
  });
});
