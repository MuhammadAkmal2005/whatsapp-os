/**
 * Repository for WebhookEvent persistence and state management.
 * CROSS-TENANT: WebhookEvents start with `workspaceId: null` at ingestion time
 * and are assigned a `workspaceId` once phone number routing resolves.
 */

import 'server-only';

import type { WebhookStatus } from '@prisma/client';

import type { Db } from '@/db/prisma';

export type WebhookEventRow = {
  id: string;
  provider: string;
  providerEventId: string;
  workspaceId: string | null;
  phoneNumberId: string | null;
  eventType: string;
  payload: unknown;
  signatureValid: boolean;
  status: WebhookStatus;
  attempts: number;
  processedAt: Date | null;
  error: string | null;
  receivedAt: Date;
};

export async function findWebhookEventById(
  db: Db,
  id: string,
): Promise<WebhookEventRow | null> {
  const row = await db.webhookEvent.findUnique({
    where: { id },
  });
  return row as WebhookEventRow | null;
}

export async function updateWebhookEventStatus(
  db: Db,
  id: string,
  data: {
    status?: WebhookStatus;
    workspaceId?: string | null;
    error?: string | null;
    processedAt?: Date | null;
  },
): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: {
      ...(data.status !== undefined && { status: data.status }),
      ...(data.workspaceId !== undefined && { workspaceId: data.workspaceId }),
      ...(data.error !== undefined && { error: data.error }),
      ...(data.processedAt !== undefined && { processedAt: data.processedAt }),
    },
  });
}
