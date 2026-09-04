import { describe, expect, it } from 'vitest';

import { ForbiddenError, NotFoundError } from '@/server/errors';
import {
  assertAllBelongToWorkspace,
  assertBelongsToWorkspace,
  assertWorkspaceMatches,
  can,
  conversationScope,
  requireAnyPermission,
  requireAuthenticated,
  requirePermission,
  type TenantContext,
} from '@/server/tenancy/context';
import type { WorkspaceRole } from '@/server/authz/permissions';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';

function contextFor(role: WorkspaceRole, workspaceId = WORKSPACE_A): TenantContext {
  return {
    user: {
      id: 'user-1',
      email: 'ahmed@akmalfashion.example',
      name: 'Ahmed Raza',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      avatarUrl: null,
    },
    workspaceId,
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

/**
 * Instruction #96. Records created inside Workspace A must be unreachable from
 * Workspace B, and the failure must be indistinguishable from the record not
 * existing at all.
 */
describe('critical security acceptance test — cross-workspace access', () => {
  const orderInA = { id: 'order-1', workspaceId: WORKSPACE_A, orderNumber: 'AF-2608-0001' };
  const contactInA = { id: 'contact-1', workspaceId: WORKSPACE_A, name: 'Fatima Sheikh' };
  const conversationInA = { id: 'conversation-1', workspaceId: WORKSPACE_A };

  it('lets Workspace A read its own order', () => {
    expect(assertBelongsToWorkspace(orderInA, WORKSPACE_A, 'Order')).toBe(orderInA);
  });

  it('refuses Workspace B the same order', () => {
    expect(() => assertBelongsToWorkspace(orderInA, WORKSPACE_B, 'Order')).toThrow(NotFoundError);
  });

  it('refuses Workspace B the contact and the conversation too', () => {
    expect(() => assertBelongsToWorkspace(contactInA, WORKSPACE_B, 'Contact')).toThrow(
      NotFoundError,
    );
    expect(() => assertBelongsToWorkspace(conversationInA, WORKSPACE_B, 'Conversation')).toThrow(
      NotFoundError,
    );
  });

  /**
   * The distinction that matters. Returning 403 for "exists but is not yours"
   * confirms the id is real, which turns sequential-looking ids into an
   * enumeration oracle for a competitor's order volume.
   */
  it('reports a foreign record as not found, never as forbidden', () => {
    let caught: unknown;
    try {
      assertBelongsToWorkspace(orderInA, WORKSPACE_B, 'Order');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(caught).not.toBeInstanceOf(ForbiddenError);
    expect((caught as NotFoundError).status).toBe(404);
  });

  it('gives byte-identical responses for a foreign record and a missing one', () => {
    const foreign = (() => {
      try {
        assertBelongsToWorkspace(orderInA, WORKSPACE_B, 'Order');
      } catch (error) {
        return error as NotFoundError;
      }
      throw new Error('expected a throw');
    })();

    const missing = (() => {
      try {
        assertBelongsToWorkspace(null, WORKSPACE_B, 'Order');
      } catch (error) {
        return error as NotFoundError;
      }
      throw new Error('expected a throw');
    })();

    expect(foreign.code).toBe(missing.code);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.message).toBe(missing.message);
  });

  it('refuses a null or undefined row', () => {
    expect(() => assertBelongsToWorkspace(null, WORKSPACE_A, 'Order')).toThrow(NotFoundError);
    expect(() => assertBelongsToWorkspace(undefined, WORKSPACE_A, 'Order')).toThrow(NotFoundError);
  });

  it('is not fooled by a workspace id that merely looks similar', () => {
    const nearMiss = `${WORKSPACE_A.slice(0, -1)}2`;
    expect(() => assertBelongsToWorkspace(orderInA, nearMiss, 'Order')).toThrow(NotFoundError);
  });

  it('is not fooled by an empty or whitespace workspace id', () => {
    for (const hostile of ['', ' ', '\u0000']) {
      expect(() => assertBelongsToWorkspace(orderInA, hostile, 'Order')).toThrow(NotFoundError);
    }
  });
});

describe('batch isolation', () => {
  it('accepts a list that is entirely one workspace', () => {
    const rows = [
      { id: '1', workspaceId: WORKSPACE_A },
      { id: '2', workspaceId: WORKSPACE_A },
    ];
    expect(assertAllBelongToWorkspace(rows, WORKSPACE_A)).toBe(rows);
  });

  /**
   * Rejecting the whole response rather than filtering the bad row out. A silent
   * filter would hide the query bug that produced the foreign row, and the next
   * such bug might be on a write path where filtering is not available.
   */
  it('rejects the whole list when one row is foreign', () => {
    const rows = [
      { id: '1', workspaceId: WORKSPACE_A },
      { id: '2', workspaceId: WORKSPACE_B },
    ];
    expect(() => assertAllBelongToWorkspace(rows, WORKSPACE_A)).toThrow(NotFoundError);
  });

  it('accepts an empty list', () => {
    expect(assertAllBelongToWorkspace([], WORKSPACE_A)).toEqual([]);
  });
});

describe('client-supplied workspace ids', () => {
  it('accepts an id matching the proven session workspace', () => {
    expect(() => assertWorkspaceMatches(contextFor('OWNER'), WORKSPACE_A)).not.toThrow();
  });

  /**
   * The core attack: put someone else's workspace id in the URL and see what
   * comes back. The id from the request is only ever compared against the one the
   * session already proved; it is never used to select a workspace.
   */
  it('refuses an id the session did not prove', () => {
    expect(() => assertWorkspaceMatches(contextFor('OWNER'), WORKSPACE_B)).toThrow(NotFoundError);
  });
});

describe('permission enforcement on the context', () => {
  it('lets an owner manage billing', () => {
    expect(() => requirePermission(contextFor('OWNER'), 'subscription:manage')).not.toThrow();
  });

  it('stops an agent managing billing', () => {
    expect(() => requirePermission(contextFor('AGENT'), 'subscription:manage')).toThrow(
      ForbiddenError,
    );
  });

  it('stops a viewer changing a price', () => {
    expect(() => requirePermission(contextFor('VIEWER'), 'product:update')).toThrow(ForbiddenError);
  });

  it('names the role in the refusal without leaking anything else', () => {
    try {
      requirePermission(contextFor('AGENT'), 'workspace:delete');
      expect.fail('expected a throw');
    } catch (error) {
      const forbidden = error as ForbiddenError;
      expect(forbidden.message).toContain('agent');
      expect(forbidden.message).not.toContain(WORKSPACE_A);
      expect(forbidden.message).not.toContain('workspace:delete');
    }
  });

  it('accepts any one of several permissions', () => {
    expect(() =>
      requireAnyPermission(contextFor('MANAGER'), ['subscription:manage', 'product:update']),
    ).not.toThrow();
    expect(() =>
      requireAnyPermission(contextFor('AGENT'), ['subscription:manage', 'member:remove']),
    ).toThrow(ForbiddenError);
  });

  it('answers capability questions without throwing', () => {
    expect(can(contextFor('MANAGER'), 'product:update')).toBe(true);
    expect(can(contextFor('MANAGER'), 'subscription:manage')).toBe(false);
  });
});

describe('conversation scoping', () => {
  it('gives the whole inbox to roles holding conversation:read_all', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'VIEWER'] as const) {
      expect(conversationScope(contextFor(role))).toEqual({ kind: 'all' });
    }
  });

  /**
   * An AGENT's list query is narrowed in SQL, driven by the absent permission —
   * not by the component deciding what to render.
   */
  it('narrows an agent to their own assignments', () => {
    expect(conversationScope(contextFor('AGENT'))).toEqual({
      kind: 'assigned',
      userId: 'user-1',
    });
  });
});

describe('requireAuthenticated', () => {
  it('passes a value through', () => {
    expect(requireAuthenticated('value')).toBe('value');
  });

  it('throws on null or undefined', () => {
    expect(() => requireAuthenticated(null)).toThrow();
    expect(() => requireAuthenticated(undefined)).toThrow();
  });

  it('does not reject legitimately falsy values', () => {
    expect(requireAuthenticated(0)).toBe(0);
    expect(requireAuthenticated('')).toBe('');
    expect(requireAuthenticated(false)).toBe(false);
  });
});
