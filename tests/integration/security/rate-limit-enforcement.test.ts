import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '@/config/constants';
import { prisma } from '@/db/prisma';
import { RateLimitError } from '@/server/errors';
import { executeAgentTurn } from '@/server/services/agent/agent-runtime.service';
import { sendMessage } from '@/server/services/conversation/message.service';
import { POST as billingWebhookPost } from '@/app/api/webhooks/billing/route';
import { NextRequest } from 'next/server';
import {
  createContactFixture,
  createWorkspaceFixture,
  resetDatabase,
} from '../fixtures';
import { hmacSha256Hex } from '@/lib/crypto';
import { env } from '@/config/env';

describe('Phase 9 Unit 1: Rate Limit Enforcement Integration Tests', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('enforces AI request rate limits per workspace', async () => {
    const ws = await createWorkspaceFixture();
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
        channel: 'WHATSAPP',
      },
    });

    // Create an active agent
    const agent = await prisma.aIAgent.create({
      data: {
        workspaceId: ws.workspaceId,
        name: 'Rate Limit Test Agent',
        role: 'SALES_SUPPORT',
        isActive: true,
        isDefault: true,
      },
    });

    const mockProvider = {
      name: 'mock',
      generateReply: async () => ({
        content: 'Hello!',
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 10,
        latencyMs: 50,
        costMicros: 20,
      }),
    };

    // Pre-populate rate limit bucket to exhaust aiRequestPerWorkspace
    const limit = RATE_LIMITS.aiRequestPerWorkspace.limit;
    await prisma.rateLimitBucket.create({
      data: {
        key: `aiRequestPerWorkspace:workspace:${ws.workspaceId}`,
        count: limit,
        resetAt: new Date(Date.now() + 60000),
      },
    });

    const result = await executeAgentTurn({
      workspaceId: ws.workspaceId,
      conversationId: conv.id,
      messageId: 'msg-rate-limit-1',
      provider: mockProvider as any,
      agentId: agent.id,
    });

    expect(result.status).toBe('FAILED');
    expect(result.errorCategory).toBe('RATE_LIMITED');
    expect(result.errorMessage).toContain('rate limit exceeded');
    expect(result.handoffTriggered).toBe(true);
  });

  it('enforces outbound message send rate limit per workspace', async () => {
    const ws = await createWorkspaceFixture();
    const contact = await createContactFixture(ws.workspaceId);
    const conv = await prisma.conversation.create({
      data: {
        workspaceId: ws.workspaceId,
        contactId: contact.id,
        status: 'OPEN',
        channel: 'WHATSAPP',
      },
    });

    // Exhaust messageSend limit
    const limit = RATE_LIMITS.messageSend.limit;
    await prisma.rateLimitBucket.create({
      data: {
        key: `messageSend:workspace:${ws.workspaceId}`,
        count: limit,
        resetAt: new Date(Date.now() + 60000),
      },
    });

    await expect(
      sendMessage(ws.context, {
        conversationId: conv.id,
        direction: 'OUTBOUND',
        body: 'This message should be rate limited',
      }),
    ).rejects.toThrow(RateLimitError);
  });

  it('enforces webhook rate limit on billing webhook route', async () => {
    const ip = '198.51.100.42';
    const limit = RATE_LIMITS.webhook.limit;

    // Exhaust webhook rate limit bucket for this IP
    await prisma.rateLimitBucket.create({
      data: {
        key: `webhook:ip:${ip}`,
        count: limit,
        resetAt: new Date(Date.now() + 60000),
      },
    });

    const rawPayload = JSON.stringify({ type: 'checkout.session.completed', data: { workspaceId: 'dummy' } });
    const secret = env.PAYMENT_WEBHOOK_SECRET || 'test_secret';
    const signature = hmacSha256Hex(secret, rawPayload);

    const req = new NextRequest('http://localhost/api/webhooks/billing', {
      method: 'POST',
      headers: {
        'x-forwarded-for': ip,
        'stripe-signature': signature,
        'content-type': 'application/json',
      },
      body: rawPayload,
    });

    const res = await billingWebhookPost(req);
    expect(res.status).toBe(429);
  });
});
