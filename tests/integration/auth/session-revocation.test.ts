import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import { hashSessionToken } from '@/server/auth/session-token';
import {
  changeMemberRole,
  removeMember,
  setMemberStatus,
} from '@/server/services/member/member.service';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

describe('Phase 9 Unit 1: Session Revocation Integration Tests', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createTestSessionForUser(userId: string, token: string) {
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
    return prisma.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
  }

  it('immediately revokes all active sessions when member role is changed', async () => {
    const ws = await createWorkspaceFixture();
    const targetMember = await createMemberFixture(ws.workspaceId, 'MANAGER', {
      emailPrefix: 'target-manager',
    });

    // Create active session for the target member
    await createTestSessionForUser(targetMember.userId, 'sample-token-1');

    const sessionsBefore = await prisma.session.findMany({
      where: { userId: targetMember.userId },
    });
    expect(sessionsBefore.length).toBe(1);

    // Change target member's role to AGENT
    await changeMemberRole(ws.context, {
      memberId: targetMember.membershipId,
      role: 'AGENT',
    });

    // Verify session is revoked
    const sessionsAfter = await prisma.session.findMany({
      where: { userId: targetMember.userId },
    });
    expect(sessionsAfter.length).toBe(0);
  });

  it('immediately revokes all active sessions when member is suspended', async () => {
    const ws = await createWorkspaceFixture();
    const targetMember = await createMemberFixture(ws.workspaceId, 'AGENT', {
      emailPrefix: 'target-agent',
    });

    // Create active session for the target member
    await createTestSessionForUser(targetMember.userId, 'sample-token-2');

    const sessionsBefore = await prisma.session.findMany({
      where: { userId: targetMember.userId },
    });
    expect(sessionsBefore.length).toBe(1);

    // Suspend target member
    await setMemberStatus(ws.context, {
      memberId: targetMember.membershipId,
      status: 'SUSPENDED',
    });

    // Verify session is revoked
    const sessionsAfter = await prisma.session.findMany({
      where: { userId: targetMember.userId },
    });
    expect(sessionsAfter.length).toBe(0);
  });

  it('immediately revokes all active sessions when member is removed from workspace', async () => {
    const ws = await createWorkspaceFixture();
    const targetMember = await createMemberFixture(ws.workspaceId, 'AGENT', {
      emailPrefix: 'target-agent-remove',
    });

    // Create multiple active sessions for the target member
    await createTestSessionForUser(targetMember.userId, 'sample-token-3a');
    await createTestSessionForUser(targetMember.userId, 'sample-token-3b');

    const sessionsBefore = await prisma.session.findMany({
      where: { userId: targetMember.userId },
    });
    expect(sessionsBefore.length).toBe(2);

    // Remove target member
    await removeMember(ws.context, {
      memberId: targetMember.membershipId,
    });

    // Verify all sessions are revoked
    const sessionsAfter = await prisma.session.findMany({
      where: { userId: targetMember.userId },
    });
    expect(sessionsAfter.length).toBe(0);
  });
});
