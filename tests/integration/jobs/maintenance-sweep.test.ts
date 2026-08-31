/**
 * Phase 9 Unit 2: Maintenance Sweep & Retention Pruning Integration Tests.
 *
 * Tests the expanded housekeeping worker, deterministic retention boundaries,
 * tenant safety, and ensuring business-critical / soft-deleted records are never purged.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/db/prisma';
import { maintenanceSweep } from '@/server/jobs/handlers/maintenance.handler';
import { createWorkspaceFixture, resetDatabase } from '../fixtures';
import { createVerificationToken } from '@/server/repositories/verification-token.repository';
import type { JobContext } from '@/server/jobs/registry';

const testContext: JobContext = {
  jobId: 'test-maint-job',
  attempt: 1,
  maxAttempts: 5,
  signal: new AbortController().signal,
};

describe('Phase 9 Unit 2: Maintenance Sweep & Retention Pruning', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('prunes expired rate-limit buckets while preserving active ones', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 60_000);

    await prisma.rateLimitBucket.createMany({
      data: [
        { key: 'expired:1', count: 5, resetAt: past },
        { key: 'expired:2', count: 10, resetAt: past },
        { key: 'active:1', count: 2, resetAt: future },
      ],
    });

    await maintenanceSweep({}, testContext);

    const remaining = await prisma.rateLimitBucket.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.key).toBe('active:1');
  });

  it('prunes expired sessions while preserving active sessions', async () => {
    const fixture = await createWorkspaceFixture();
    const now = new Date();
    const past = new Date(now.getTime() - 3600_000);
    const future = new Date(now.getTime() + 3600_000);

    await prisma.session.createMany({
      data: [
        { userId: fixture.ownerUserId, tokenHash: 'hash-expired', expiresAt: past },
        { userId: fixture.ownerUserId, tokenHash: 'hash-active', expiresAt: future },
      ],
    });

    await maintenanceSweep({}, testContext);

    const remaining = await prisma.session.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.tokenHash).toBe('hash-active');
  });

  it('prunes completed jobs older than 3 days and dead jobs older than 30 days', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60_000);
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60_000);
    const thirtyFiveDaysAgo = new Date(now.getTime() - 35 * 24 * 60 * 60_000);

    await prisma.job.createMany({
      data: [
        { type: 'test.job', payload: {}, status: 'COMPLETED', completedAt: fourDaysAgo }, // pruned
        { type: 'test.job', payload: {}, status: 'COMPLETED', completedAt: twoDaysAgo },  // kept (< 3d)
        { type: 'test.job', payload: {}, status: 'DEAD', completedAt: thirtyFiveDaysAgo }, // pruned (> 30d)
        { type: 'test.job', payload: {}, status: 'DEAD', completedAt: twentyDaysAgo },    // kept (< 30d)
        { type: 'test.job', payload: {}, status: 'PENDING', runAfter: now },              // active, kept
      ],
    });

    await maintenanceSweep({}, testContext);

    const remaining = await prisma.job.findMany({ orderBy: { status: 'asc' } });
    expect(remaining).toHaveLength(3);
    const statuses = remaining.map((j) => j.status);
    expect(statuses).toContain('COMPLETED');
    expect(statuses).toContain('DEAD');
    expect(statuses).toContain('PENDING');
  });

  it('prunes processed webhooks older than 14 days while keeping recent or pending ones', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60_000);
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60_000);

    await prisma.webhookEvent.createMany({
      data: [
        {
          provider: 'whatsapp',
          providerEventId: 'evt-old-processed',
          eventType: 'messages',
          payload: {},
          signatureValid: true,
          status: 'PROCESSED',
          receivedAt: twentyDaysAgo,
          processedAt: twentyDaysAgo,
        },
        {
          provider: 'whatsapp',
          providerEventId: 'evt-recent-processed',
          eventType: 'messages',
          payload: {},
          signatureValid: true,
          status: 'PROCESSED',
          receivedAt: tenDaysAgo,
          processedAt: tenDaysAgo,
        },
        {
          provider: 'whatsapp',
          providerEventId: 'evt-old-received',
          eventType: 'messages',
          payload: {},
          signatureValid: true,
          status: 'RECEIVED',
          receivedAt: twentyDaysAgo,
        },
      ],
    });

    await maintenanceSweep({}, testContext);

    const remaining = await prisma.webhookEvent.findMany();
    expect(remaining).toHaveLength(2);
    const ids = remaining.map((e) => e.providerEventId);
    expect(ids).toContain('evt-recent-processed');
    expect(ids).toContain('evt-old-received');
  });

  it('prunes expired and old-consumed verification tokens', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 3600_000);
    const future = new Date(now.getTime() + 3600_000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60_000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000);

    const activeHash = `token-active-${randomUUID()}`;
    const recentConsumedHash = `token-consumed-recent-${randomUUID()}`;

    await createVerificationToken(prisma, {
      identifier: 'expired@example.com',
      tokenHash: `token-expired-${randomUUID()}`,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: past,
    });

    await createVerificationToken(prisma, {
      identifier: 'active@example.com',
      tokenHash: activeHash,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: future,
    });

    const oldConsumed = await createVerificationToken(prisma, {
      identifier: 'consumed-old@example.com',
      tokenHash: `token-consumed-old-${randomUUID()}`,
      purpose: 'PASSWORD_RESET',
      expiresAt: future,
    });
    await prisma.verificationToken.update({
      where: { id: oldConsumed.id },
      data: { consumedAt: tenDaysAgo },
    });

    const recentConsumed = await createVerificationToken(prisma, {
      identifier: 'consumed-recent@example.com',
      tokenHash: recentConsumedHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: future,
    });
    await prisma.verificationToken.update({
      where: { id: recentConsumed.id },
      data: { consumedAt: twoDaysAgo },
    });

    await maintenanceSweep({}, testContext);

    const remaining = await prisma.verificationToken.findMany();
    expect(remaining).toHaveLength(2);
    const hashes = remaining.map((t) => t.tokenHash);
    expect(hashes).toContain(activeHash);
    expect(hashes).toContain(recentConsumedHash);
  });

  it('CRITICAL DELETION SAFETY: never hard-deletes soft-deleted business entities during sweep', async () => {
    const fixture = await createWorkspaceFixture();
    const now = new Date();
    const past = new Date(now.getTime() - 60 * 24 * 60 * 60_000); // 60 days ago

    // Soft-deleted Contact
    const contact = await prisma.contact.create({
      data: {
        workspaceId: fixture.workspaceId,
        name: 'Historical Customer',
        phoneE164: '+923009998877',
        deletedAt: past,
      },
    });

    // Soft-deleted Product
    const product = await prisma.product.create({
      data: {
        workspaceId: fixture.workspaceId,
        name: 'Discontinued Kurta',
        slug: 'discontinued-kurta',
        priceMinor: 250000,
        currency: 'PKR',
        deletedAt: past,
      },
    });

    // Soft-deleted Order
    const order = await prisma.order.create({
      data: {
        workspaceId: fixture.workspaceId,
        orderNumber: 'HIST-2608-0001',
        contactId: contact.id,
        subtotalMinor: 250000,
        totalMinor: 250000,
        customerName: 'Historical Customer',
        phoneE164: '+923009998877',
        deletedAt: past,
      },
    });

    // Run maintenance sweep
    await maintenanceSweep({}, testContext);

    // Assert that all business records remain present in the database (soft-deleted, not hard-deleted)
    const checkContact = await prisma.contact.findUnique({ where: { id: contact.id } });
    const checkProduct = await prisma.product.findUnique({ where: { id: product.id } });
    const checkOrder = await prisma.order.findUnique({ where: { id: order.id } });

    expect(checkContact).not.toBeNull();
    expect(checkContact?.deletedAt).toEqual(past);

    expect(checkProduct).not.toBeNull();
    expect(checkProduct?.deletedAt).toEqual(past);

    expect(checkOrder).not.toBeNull();
    expect(checkOrder?.deletedAt).toEqual(past);
  });
});
