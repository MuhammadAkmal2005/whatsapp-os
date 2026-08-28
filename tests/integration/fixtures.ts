/**
 * Fixtures for the integration suite.
 *
 * These write to a real database — the throwaway one on 5433 that `tests/setup.ts`
 * forces `DATABASE_URL` to. They deliberately insert through Prisma rather than
 * through the services: a fixture that used `createContact` to set up a test of
 * `createContact` would pass whenever the service was self-consistently wrong.
 *
 * Every helper takes and returns real ids. Nothing here is shared between tests
 * beyond the schema itself; `resetDatabase` runs between them.
 */

import { randomUUID } from 'node:crypto';

import type { SupportedCurrency } from '@/config/constants';
import { prisma } from '@/db/prisma';
import type { WorkspaceRole } from '@/server/authz/permissions';
import type { TenantContext } from '@/server/tenancy/context';

/**
 * A scrypt-shaped string that no password hashes to.
 *
 * Fixtures never log in, so hashing a real password would spend 65,536 rounds of
 * key derivation per fixture user for a column nothing reads. The shape is kept
 * valid so a test that *does* exercise verification fails on the comparison rather
 * than on parsing.
 */
const UNUSABLE_PASSWORD_HASH = 'scrypt$65536$8$1$0000000000000000$0000000000000000';

/**
 * Truncates in one statement with CASCADE.
 *
 * `users` and `workspaces` are the two roots — every tenant table hangs off a
 * workspace and every membership off a user — so cascading from both clears the
 * schema without naming forty tables that would then need maintaining every time a
 * model is added. `RESTART IDENTITY` is included for the sequences behind any
 * non-uuid keys.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE users, workspaces, jobs, webhook_events, rate_limit_buckets RESTART IDENTITY CASCADE',
  );
}

export type WorkspaceFixture = {
  workspaceId: string;
  workspaceSlug: string;
  ownerUserId: string;
  ownerMembershipId: string;
  /** A tenant context for the owner, ready to pass to a service. */
  context: TenantContext;
};

/**
 * One business with one owner.
 *
 * `slug` and the owner's email are suffixed with a random fragment because both are
 * globally unique: two fixtures in the same test would otherwise collide on the
 * unique index, and the failure would read as a bug in the code under test.
 */
export async function createWorkspaceFixture(
  options: { name?: string; currency?: SupportedCurrency; country?: string } = {},
): Promise<WorkspaceFixture> {
  const suffix = randomUUID().slice(0, 8);
  const name = options.name ?? 'Akmal Fashion';
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`;
  const currency = options.currency ?? 'PKR';

  const workspace = await prisma.workspace.create({
    data: { slug, name, currency },
  });

  if (options.country) {
    await prisma.businessProfile.create({
      data: { workspaceId: workspace.id, country: options.country },
    });
  }

  const owner = await createMemberFixture(workspace.id, 'OWNER', {
    name: 'Ahmed Raza',
    emailPrefix: `owner-${suffix}`,
  });

  return {
    workspaceId: workspace.id,
    workspaceSlug: slug,
    ownerUserId: owner.userId,
    ownerMembershipId: owner.membershipId,
    context: tenantContextFor({
      workspaceId: workspace.id,
      workspaceSlug: slug,
      workspaceName: name,
      currency,
      userId: owner.userId,
      userName: 'Ahmed Raza',
      userEmail: owner.email,
      membershipId: owner.membershipId,
      role: 'OWNER',
    }),
  };
}

export type MemberFixture = {
  userId: string;
  membershipId: string;
  email: string;
  name: string;
};

export async function createMemberFixture(
  workspaceId: string,
  role: WorkspaceRole,
  options: { name?: string; emailPrefix?: string; status?: 'ACTIVE' | 'SUSPENDED' } = {},
): Promise<MemberFixture> {
  const suffix = randomUUID().slice(0, 8);
  const name = options.name ?? 'Ayesha Khan';
  // A reserved TLD, so a fixture email can never be delivered to even if one
  // escaped into an outbound message.
  const email = `${options.emailPrefix ?? `member-${suffix}`}@example.test`;

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: UNUSABLE_PASSWORD_HASH,
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      role,
      status: options.status ?? 'ACTIVE',
    },
  });

  return { userId: user.id, membershipId: member.id, email, name };
}

/**
 * Builds the context a service expects, for a member the test has already created.
 *
 * Constructed by hand rather than resolved from a session, because the session path
 * is the subject of its own tests and going through it here would make every
 * integration test depend on cookie handling. What matters is that `workspaceId` is
 * the one the fixture created — the whole point of the isolation tests is that a
 * service given Workspace B's context cannot reach Workspace A's rows.
 */
export function tenantContextFor(input: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  currency: SupportedCurrency;
  userId: string;
  userName: string;
  userEmail: string;
  membershipId: string;
  role: WorkspaceRole;
  planKey?: string;
}): TenantContext {
  return {
    user: {
      id: input.userId,
      email: input.userEmail,
      name: input.userName,
      emailVerifiedAt: new Date(),
      avatarUrl: null,
    },
    workspaceId: input.workspaceId,
    workspaceSlug: input.workspaceSlug,
    workspaceName: input.workspaceName,
    role: input.role,
    membershipId: input.membershipId,
    sessionId: randomUUID(),
    currency: input.currency,
    planKey: input.planKey ?? 'business',
    requestId: randomUUID(),
  };
}

/**
 * A contact inserted directly, so a test of a read path does not depend on the
 * write path being correct. Phone numbers are fictional and in the +92 300 range
 * that Pakistani mobile numbers use, with a random suffix to stay clear of the
 * `@@unique([workspaceId, phoneE164])` index.
 */
export async function createContactFixture(
  workspaceId: string,
  overrides: {
    name?: string;
    phoneE164?: string;
    assignedToMemberId?: string | null;
    city?: string | null;
  } = {},
): Promise<{ id: string; phoneE164: string; name: string }> {
  const digits = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  const phoneE164 = overrides.phoneE164 ?? `+92300${digits}`;
  const name = overrides.name ?? 'Fatima Sheikh';

  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      phoneE164,
      name,
      assignedToMemberId: overrides.assignedToMemberId ?? null,
      city: overrides.city ?? 'Karachi',
    },
  });

  return { id: contact.id, phoneE164, name };
}
