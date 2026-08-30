import { describe, expect, it } from 'vitest';
import { prisma } from '@/db/prisma';
import { LimitExceededError } from '@/server/errors';
import { createContact } from '@/server/services/contact/contact.service';
import { inviteMember } from '@/server/services/member/member.service';
import { createProduct } from '@/server/services/product/product.service';
import {
  changeSubscriptionPlan,
  ensureWorkspaceSubscription,
} from '@/server/services/subscription/subscription.service';
import { createContactSchema } from '@/server/validation/contact';
import { createProductSchema } from '@/server/validation/product';
import {
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';

describe('Phase 8 Unit 2: Quota Write-Path Enforcement Integration', () => {
  it('1. enforces product quota limits before creation on Free and upgraded tiers', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Product Quota Store' });

    // Set workspace to Free plan (20 products limit)
    await changeSubscriptionPlan(ws.context, { planKey: 'free' });

    // Bulk insert 20 products to reach limit
    const productsData = Array.from({ length: 20 }, (_, i) => ({
      workspaceId: ws.workspaceId,
      name: `Kurta Item ${i + 1}`,
      slug: `kurta-item-${i + 1}`,
      currency: 'PKR',
      priceMinor: 250000,
    }));
    await prisma.product.createMany({ data: productsData });

    // 21st product creation via createProduct should fail closed
    await expect(
      createProduct(
        ws.context,
        createProductSchema.parse({
          name: 'Extra Kurta 21',
          sku: 'KURTA-21',
          priceMinor: '2500',
        }),
      ),
    ).rejects.toThrow(LimitExceededError);

    // Upgrade to Starter plan (200 products limit)
    await changeSubscriptionPlan(ws.context, { planKey: 'starter' });

    // 21st product creation now succeeds
    const created = await createProduct(
      ws.context,
      createProductSchema.parse({
        name: 'Extra Kurta 21',
        sku: 'KURTA-21',
        priceMinor: '2500',
      }),
    );
    expect(created.name).toBe('Extra Kurta 21');
  });

  it('2. enforces contact quota limits before creation on Free tier', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Contact Quota Store' });

    // Set to Free plan (100 contacts limit)
    await changeSubscriptionPlan(ws.context, { planKey: 'free' });

    // Bulk insert 100 contacts
    const contactsData = Array.from({ length: 100 }, (_, i) => ({
      workspaceId: ws.workspaceId,
      phoneE164: `+923000000${String(i).padStart(3, '0')}`,
      name: `Customer ${i + 1}`,
    }));
    await prisma.contact.createMany({ data: contactsData });

    // 101st contact creation via createContact fails closed
    await expect(
      createContact(
        ws.context,
        createContactSchema.parse({
          phone: '+923009999999',
          name: 'Exceeded Customer',
        }),
      ),
    ).rejects.toThrow(LimitExceededError);
  });

  it('3. enforces team member quota limits before invitation', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Team Seat Store' });

    // Set to Free plan (1 team member seat limit)
    await changeSubscriptionPlan(ws.context, { planKey: 'free' });

    // Owner is already 1 member. Inviting 2nd member should throw LimitExceededError
    await expect(
      inviteMember(ws.context, {
        email: 'collaborator@example.com',
        role: 'AGENT',
      }),
    ).rejects.toThrow(LimitExceededError);

    // Upgrade to Starter plan (3 seats limit)
    await changeSubscriptionPlan(ws.context, { planKey: 'starter' });

    // Inviting member now succeeds
    const invite = await inviteMember(ws.context, {
      email: 'collaborator@example.com',
      role: 'AGENT',
    });
    expect(invite.email).toBe('collaborator@example.com');
  });

  it('4. enforces Free tier limits immediately when a trial expires without data loss', async () => {
    await resetDatabase();
    const ws = await createWorkspaceFixture({ name: 'Expired Trial Quota Store' });
    await ensureWorkspaceSubscription(prisma, ws.workspaceId);

    // Insert 20 products
    const productsData = Array.from({ length: 20 }, (_, i) => ({
      workspaceId: ws.workspaceId,
      name: `Dress ${i + 1}`,
      slug: `dress-${i + 1}`,
      currency: 'PKR',
      priceMinor: 300000,
    }));
    await prisma.product.createMany({ data: productsData });

    // Set trial expiration in past (expired trial)
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { workspaceId: ws.workspaceId },
      data: { trialEndsAt: past, currentPeriodEnd: past },
    });

    // Write path automatically evaluates Free plan limits -> throws LimitExceededError
    await expect(
      createProduct(
        ws.context,
        createProductSchema.parse({
          name: 'Dress 21',
          sku: 'DRESS-21',
          priceMinor: '3000',
        }),
      ),
    ).rejects.toThrow(LimitExceededError);

    // All existing 20 products remain untouched
    const count = await prisma.product.count({
      where: { workspaceId: ws.workspaceId },
    });
    expect(count).toBe(20);
  });
});
