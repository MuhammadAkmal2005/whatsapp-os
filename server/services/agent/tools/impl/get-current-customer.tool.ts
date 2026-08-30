import 'server-only';

import { z } from 'zod';
import { prisma } from '@/db/prisma';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';
import { findContactById } from '@/server/repositories/contact.repository';
import { findConversationById } from '@/server/repositories/conversation.repository';
import type { ContactStatus, LeadStage } from '@/server/validation/contact';

export interface CurrentCustomerResultDTO {
  name?: string;
  status: ContactStatus;
  leadStage: LeadStage;
  totalOrders: number;
  lastOrderAt?: string;
}

export const getCurrentCustomerTool: AITool<
  Record<string, never>,
  CurrentCustomerResultDTO | { error: string; message: string }
> = {
  name: 'get_current_customer',
  description:
    'Retrieve minimized customer profile information (name, customer status, lead stage, order counts) for the contact in the current conversation.',
  inputSchema: z
    .object({})
    .describe('No arguments required; resolves the customer from the current conversation context'),
  classification: 'READ',
  capabilityRequired: 'contacts:read',
  sideEffect: 'NONE',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: false,
  handler: async (ctx: AITenantContext) => {
    const conversation = await findConversationById(prisma, ctx.workspaceId, ctx.conversationId);

    if (!conversation || !conversation.contactId) {
      return {
        error: 'NOT_FOUND',
        message: 'Current conversation or customer contact not found.',
      };
    }

    const contact = await findContactById(prisma, ctx.workspaceId, conversation.contactId);

    if (!contact) {
      return {
        error: 'NOT_FOUND',
        message: 'Customer record not found.',
      };
    }

    return {
      name: contact.name ?? contact.waProfileName ?? undefined,
      status: contact.status,
      leadStage: contact.leadStage,
      totalOrders: contact.totalOrders,
      lastOrderAt: contact.lastOrderAt ? contact.lastOrderAt.toISOString() : undefined,
    };
  },
};
