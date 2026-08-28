import { beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '@/config/env';
import { prisma } from '@/db/prisma';
import { decryptSecret } from '@/lib/crypto';
import { ForbiddenError, ValidationError } from '@/server/errors';
import {
  connectWhatsAppAccount,
  disconnectWhatsAppAccount,
  getWhatsAppAccountOverview,
} from '@/server/services/whatsapp/whatsapp-account.service';
import {
  createMemberFixture,
  createWorkspaceFixture,
  resetDatabase,
  tenantContextFor,
} from '../fixtures';

describe('WhatsApp Account Service & Settings Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.restoreAllMocks();
  });

  it('1. allows OWNER to connect WhatsApp account in mock mode', async () => {
    const fixture = await createWorkspaceFixture();

    const result = await connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_test_1001',
        phoneNumberId: 'pn_test_1001',
        displayPhoneNumber: '+92 300 1112233',
        accessToken: 'EAAG_mock_token_12345',
        displayName: 'Akmal Fashion Live',
      },
      { forceMock: true },
    );

    expect(result.status).toBe('CONNECTED');
    expect(result.isMock).toBe(true);
    expect(result.wabaId).toBe('waba_test_1001');
    expect(result.phoneNumbers[0]?.phoneNumberId).toBe('pn_test_1001');
    expect(result.phoneNumbers[0]?.displayPhoneNumber).toBe('+92 300 1112233');

    // Verify DB state
    const dbAccount = await prisma.whatsAppAccount.findUnique({
      where: { id: result.id },
    });
    expect(dbAccount).not.toBeNull();
    expect(dbAccount?.accessTokenEncrypted).not.toBeNull();
    expect(dbAccount?.accessTokenEncrypted?.startsWith('v1:')).toBe(true);

    // Verify token can be decrypted with AUTH_SECRET
    const decrypted = decryptSecret(dbAccount!.accessTokenEncrypted!, env.AUTH_SECRET);
    expect(decrypted).toBe('EAAG_mock_token_12345');

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId: fixture.workspaceId, action: 'whatsapp.account.connected' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.metadata)).not.toContain('EAAG_mock_token_12345');
  });

  it('2. allows ADMIN to connect WhatsApp account', async () => {
    const fixture = await createWorkspaceFixture();
    const adminMember = await createMemberFixture(fixture.workspaceId, 'ADMIN', {
      name: 'Admin User',
    });

    const adminCtx = tenantContextFor({
      workspaceId: fixture.workspaceId,
      workspaceSlug: fixture.workspaceSlug,
      workspaceName: 'Akmal Fashion',
      currency: 'PKR',
      userId: adminMember.userId,
      userName: adminMember.name,
      userEmail: adminMember.email,
      membershipId: adminMember.membershipId,
      role: 'ADMIN',
    });

    const result = await connectWhatsAppAccount(
      adminCtx,
      {
        wabaId: 'waba_admin_1002',
        phoneNumberId: 'pn_admin_1002',
        displayPhoneNumber: '+92 300 9998877',
        accessToken: 'EAAG_admin_token_999',
      },
      { forceMock: true },
    );

    expect(result.status).toBe('CONNECTED');
    expect(result.wabaId).toBe('waba_admin_1002');
  });

  it('3. rejects unauthorized AGENT or VIEWER roles with ForbiddenError', async () => {
    const fixture = await createWorkspaceFixture();
    const agentMember = await createMemberFixture(fixture.workspaceId, 'AGENT', {
      name: 'Agent User',
    });

    const agentCtx = tenantContextFor({
      workspaceId: fixture.workspaceId,
      workspaceSlug: fixture.workspaceSlug,
      workspaceName: 'Akmal Fashion',
      currency: 'PKR',
      userId: agentMember.userId,
      userName: agentMember.name,
      userEmail: agentMember.email,
      membershipId: agentMember.membershipId,
      role: 'AGENT',
    });

    await expect(
      connectWhatsAppAccount(
        agentCtx,
        {
          wabaId: 'waba_fail',
          phoneNumberId: 'pn_fail',
          displayPhoneNumber: '+92 300 1234567',
          accessToken: 'EAAG_fail',
        },
        { forceMock: true },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('4. performs live Meta credential validation and populates verified name on success', async () => {
    const fixture = await createWorkspaceFixture();

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verified_name: 'Verified Official Brand',
        display_phone_number: '+92 300 5554433',
        quality_rating: 'GREEN',
      }),
    });

    const result = await connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_live_001',
        phoneNumberId: '106540352242922',
        displayPhoneNumber: '+92 300 5554433',
        accessToken: 'EAAG_live_valid_token_123',
      },
      { forceMock: false, fetchFn: mockFetch as unknown as typeof fetch },
    );

    expect(result.status).toBe('CONNECTED');
    expect(result.isMock).toBe(false);
    expect(result.phoneNumbers[0]?.verifiedName).toBe('Verified Official Brand');
    expect(result.phoneNumbers[0]?.qualityRating).toBe('GREEN');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('5. live credential validation failure rejects connection and does NOT persist credentials', async () => {
    const fixture = await createWorkspaceFixture();

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        error: { message: 'Invalid OAuth token', code: 190 },
      }),
    });

    const promise = connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_live_fail',
        phoneNumberId: '106540352242922',
        displayPhoneNumber: '+92 300 5554433',
        accessToken: 'EAAG_bad_token',
      },
      { forceMock: false, fetchFn: mockFetch as unknown as typeof fetch },
    );

    await expect(promise).rejects.toThrow(ValidationError);

    // Verify nothing was persisted
    const count = await prisma.whatsAppAccount.count({
      where: { workspaceId: fixture.workspaceId },
    });
    expect(count).toBe(0);
  });

  it('6. rejects duplicate phoneNumberId already claimed by another workspace', async () => {
    const fixtureA = await createWorkspaceFixture();
    const fixtureB = await createWorkspaceFixture();

    // Workspace A connects phone number pn_shared_123
    await connectWhatsAppAccount(
      fixtureA.context,
      {
        wabaId: 'waba_a_1',
        phoneNumberId: 'pn_shared_123',
        displayPhoneNumber: '+92 300 1111111',
        accessToken: 'token_a',
      },
      { forceMock: true },
    );

    // Workspace B attempts to connect the same phone number pn_shared_123
    const promise = connectWhatsAppAccount(
      fixtureB.context,
      {
        wabaId: 'waba_b_1',
        phoneNumberId: 'pn_shared_123',
        displayPhoneNumber: '+92 300 1111111',
        accessToken: 'token_b',
      },
      { forceMock: true },
    );

    await expect(promise).rejects.toThrow(ValidationError);
    await expect(promise).rejects.toThrow('already connected to another workspace');
  });

  it('7. updates and reconnects existing account for the same workspace without duplicating rows', async () => {
    const fixture = await createWorkspaceFixture();

    // 1. Initial connect
    await connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_reconnect_1',
        phoneNumberId: 'pn_reconnect_1',
        displayPhoneNumber: '+92 300 1234567',
        accessToken: 'token_initial',
        displayName: 'Original Name',
      },
      { forceMock: true },
    );

    // 2. Reconnect / Update token & display name
    const updated = await connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_reconnect_1',
        phoneNumberId: 'pn_reconnect_1',
        displayPhoneNumber: '+92 300 1234567',
        accessToken: 'token_refreshed_999',
        displayName: 'Updated Name',
      },
      { forceMock: true },
    );

    expect(updated.displayName).toBe('Updated Name');

    const accountCount = await prisma.whatsAppAccount.count({
      where: { workspaceId: fixture.workspaceId },
    });
    expect(accountCount).toBe(1);

    const phoneCount = await prisma.whatsAppPhoneNumber.count({
      where: { workspaceId: fixture.workspaceId },
    });
    expect(phoneCount).toBe(1);

    const dbAccount = await prisma.whatsAppAccount.findUnique({ where: { id: updated.id } });
    const decrypted = decryptSecret(dbAccount!.accessTokenEncrypted!, env.AUTH_SECRET);
    expect(decrypted).toBe('token_refreshed_999');

    // Audit log should register update
    const updateAudit = await prisma.auditLog.findFirst({
      where: { workspaceId: fixture.workspaceId, action: 'whatsapp.account.updated' },
    });
    expect(updateAudit).not.toBeNull();
  });

  it('8. disconnectWhatsAppAccount clears encrypted token and sets status to DISCONNECTED', async () => {
    const fixture = await createWorkspaceFixture();

    const connected = await connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_disc_1',
        phoneNumberId: 'pn_disc_1',
        displayPhoneNumber: '+92 300 1234567',
        accessToken: 'token_to_clear',
      },
      { forceMock: true },
    );

    await disconnectWhatsAppAccount(fixture.context, connected.id);

    const dbAccount = await prisma.whatsAppAccount.findUnique({ where: { id: connected.id } });
    expect(dbAccount?.status).toBe('DISCONNECTED');
    expect(dbAccount?.accessTokenEncrypted).toBeNull();

    const dbPhone = await prisma.whatsAppPhoneNumber.findUnique({
      where: { phoneNumberId: 'pn_disc_1' },
    });
    expect(dbPhone?.status).toBe('DISCONNECTED');

    // Audit log for disconnect
    const discAudit = await prisma.auditLog.findFirst({
      where: { workspaceId: fixture.workspaceId, action: 'whatsapp.account.disconnected' },
    });
    expect(discAudit).not.toBeNull();
  });

  it('9. getWhatsAppAccountOverview returns workspace accounts without exposing access tokens', async () => {
    const fixture = await createWorkspaceFixture();

    await connectWhatsAppAccount(
      fixture.context,
      {
        wabaId: 'waba_overview_1',
        phoneNumberId: 'pn_overview_1',
        displayPhoneNumber: '+92 300 1234567',
        accessToken: 'EAAG_super_sensitive_token',
      },
      { forceMock: true },
    );

    const overview = await getWhatsAppAccountOverview(fixture.context);
    expect(overview.length).toBe(1);
    expect(overview[0]?.wabaId).toBe('waba_overview_1');
    expect((overview[0] as any).accessTokenEncrypted).toBeUndefined();
    expect((overview[0] as any).accessToken).toBeUndefined();
  });

  it('10. prevents cross-tenant access to WhatsApp accounts in getWhatsAppAccountOverview', async () => {
    const fixtureA = await createWorkspaceFixture();
    const fixtureB = await createWorkspaceFixture();

    await connectWhatsAppAccount(
      fixtureA.context,
      {
        wabaId: 'waba_ws_a',
        phoneNumberId: 'pn_ws_a',
        displayPhoneNumber: '+92 300 1111111',
        accessToken: 'token_a',
      },
      { forceMock: true },
    );

    const overviewB = await getWhatsAppAccountOverview(fixtureB.context);
    expect(overviewB.length).toBe(0);
  });
});
