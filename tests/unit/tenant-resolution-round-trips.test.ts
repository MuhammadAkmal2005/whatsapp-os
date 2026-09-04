/**
 * Round-trip and isolation contract for tenant resolution.
 *
 * The membership read is on the critical path of every authenticated navigation,
 * so its *shape* matters as much as its result: resolving a slug used to cost two
 * sequential queries, and this file is what stops that regressing. It also pins
 * the isolation properties the collapse had to preserve — the scope is still the
 * caller's own `userId`, a soft-deleted workspace still resolves to null, and a
 * slug the caller is not a member of is indistinguishable from one that does not
 * exist.
 *
 * The repository takes its client as a parameter, so a recording fake is enough;
 * these assertions need no database.
 */

import { describe, expect, it } from 'vitest';

import type { Db } from '@/db/prisma';
import {
  findMembershipBySlug,
  findMembershipForContext,
} from '@/server/repositories/workspace.repository';

type RecordedQuery = { model: string; operation: string; args: Record<string, unknown> };

/** A row shaped like what the context select returns. */
function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-1',
    role: 'OWNER',
    status: 'ACTIVE',
    workspace: {
      id: 'workspace-1',
      slug: 'akmal-fashion',
      name: 'Akmal Fashion',
      status: 'ACTIVE',
      currency: 'PKR',
      deletedAt: null,
      onboardingCompletedSteps: ['business_created', 'whatsapp_connected'],
      onboardingCompletedAt: null,
      subscription: { planKey: 'business' },
      ...overrides,
    },
  };
}

function fakeDb(memberRow: unknown) {
  const queries: RecordedQuery[] = [];
  const record =
    (model: string, operation: string, result: unknown) =>
    async (args: Record<string, unknown>) => {
      queries.push({ model, operation, args });
      return result;
    };

  const db = {
    workspaceMember: {
      findFirst: record('workspaceMember', 'findFirst', memberRow),
      findUnique: record('workspaceMember', 'findUnique', memberRow),
    },
    // Present but expected to stay untouched: reaching for it is the regression.
    workspace: {
      findFirst: record('workspace', 'findFirst', { id: 'workspace-1' }),
      findUnique: record('workspace', 'findUnique', { id: 'workspace-1' }),
    },
  };

  return { db: db as unknown as Db, queries };
}

describe('Tenant resolution round trips', () => {
  it('resolves a slug in a single query, without a separate slug lookup', async () => {
    const { db, queries } = fakeDb(membershipRow());

    const row = await findMembershipBySlug(db, 'akmal-fashion', 'user-1');

    expect(row?.workspace.id).toBe('workspace-1');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.model).toBe('workspaceMember');
    expect(queries.some((query) => query.model === 'workspace')).toBe(false);
  });

  it('scopes the slug lookup by the caller’s own userId and excludes deleted workspaces', async () => {
    const { db, queries } = fakeDb(membershipRow());

    await findMembershipBySlug(db, 'akmal-fashion', 'user-1');

    expect(queries[0]?.args.where).toEqual({
      userId: 'user-1',
      workspace: { slug: 'akmal-fashion', deletedAt: null },
    });
  });

  it('returns null for a slug the caller is not a member of', async () => {
    const { db, queries } = fakeDb(null);

    expect(await findMembershipBySlug(db, 'someone-elses-shop', 'user-1')).toBeNull();
    // Null, not an error, and no follow-up query: "not yours" and "does not
    // exist" have to look identical from outside.
    expect(queries).toHaveLength(1);
  });

  it('returns null for a soft-deleted workspace even if the row comes back', async () => {
    const { db } = fakeDb(membershipRow({ deletedAt: new Date('2026-01-01T00:00:00.000Z') }));

    expect(await findMembershipBySlug(db, 'akmal-fashion', 'user-1')).toBeNull();
  });

  it('carries onboarding progress and the plan key so callers need no second read', async () => {
    const { db } = fakeDb(membershipRow());

    const row = await findMembershipBySlug(db, 'akmal-fashion', 'user-1');

    expect(row?.workspace.onboardingCompletedSteps).toEqual([
      'business_created',
      'whatsapp_connected',
    ]);
    expect(row?.workspace.onboardingCompletedAt).toBeNull();
    expect(row?.planKey).toBe('business');
  });

  it('fails closed to no plan when the workspace has no subscription row', async () => {
    const { db } = fakeDb(membershipRow({ subscription: null }));

    const row = await findMembershipBySlug(db, 'akmal-fashion', 'user-1');

    expect(row?.planKey).toBeNull();
  });

  it('still resolves by id on the compound membership key', async () => {
    const { db, queries } = fakeDb(membershipRow());

    const row = await findMembershipForContext(db, 'workspace-1', 'user-1');

    expect(row?.membershipId).toBe('membership-1');
    expect(queries).toHaveLength(1);
    expect(queries[0]?.operation).toBe('findUnique');
    expect(queries[0]?.args.where).toEqual({
      workspaceId_userId: { workspaceId: 'workspace-1', userId: 'user-1' },
    });
  });

  it('selects identical columns on both resolution paths', async () => {
    const bySlug = fakeDb(membershipRow());
    const byId = fakeDb(membershipRow());

    await findMembershipBySlug(bySlug.db, 'akmal-fashion', 'user-1');
    await findMembershipForContext(byId.db, 'workspace-1', 'user-1');

    // The two paths build one `TenantContext` shape between them; a column added
    // to one and not the other is a context that is complete on some routes only.
    expect(bySlug.queries[0]?.args.select).toEqual(byId.queries[0]?.args.select);
  });
});
