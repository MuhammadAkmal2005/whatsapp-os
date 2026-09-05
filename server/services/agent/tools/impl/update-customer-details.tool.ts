/**
 * `update_customer_details` — Safe customer contact update tool.
 *
 * Allows the AI employee to record or update non-sensitive customer delivery and contact details
 * (such as customer name, street address, apartment/suite, city, or postal code) when explicitly
 * provided during conversation.
 *
 * SENSITIVITY & SAFETY BOUNDARIES:
 * - This tool ONLY updates non-sensitive contact/delivery fields: name, addressLine1, addressLine2,
 *   city, postalCode.
 * - It CANNOT change customer balances, roles, lead status, phone number identity, or financial records.
 * - It is strictly scoped to the verified contact behind the current conversation in `ctx.workspaceId`.
 * - Requires 'contacts:update' capability on the AI agent context.
 */

import 'server-only';

import { z } from 'zod';

import { prisma } from '@/db/prisma';
import { findContactById, updateContact } from '@/server/repositories/contact.repository';
import { findConversationById } from '@/server/repositories/conversation.repository';
import type { AITenantContext } from '../../context';
import type { AITool } from '../tool-contract';

const updateCustomerDetailsInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name too long')
    .optional()
    .describe('The customer full name or preferred name.'),
  addressLine1: z
    .string()
    .trim()
    .min(1, 'Address cannot be empty')
    .max(200, 'Address too long')
    .optional()
    .describe('Street address, house number, or building name for delivery.'),
  addressLine2: z
    .string()
    .trim()
    .max(200, 'Address line 2 too long')
    .optional()
    .describe('Apartment, suite, unit, floor, or landmark.'),
  city: z
    .string()
    .trim()
    .min(1, 'City cannot be empty')
    .max(100, 'City name too long')
    .optional()
    .describe('City or town name.'),
  postalCode: z
    .string()
    .trim()
    .max(20, 'Postal code too long')
    .optional()
    .describe('Postal code or ZIP code.'),
});

export type UpdateCustomerDetailsInput = z.infer<typeof updateCustomerDetailsInputSchema>;

export type UpdateCustomerDetailsToolResult =
  | {
      success: true;
      message: string;
      contactId: string;
      updatedFields: Partial<UpdateCustomerDetailsInput>;
    }
  | {
      success: false;
      error: string;
      message: string;
    };

export const updateCustomerDetailsTool: AITool<
  UpdateCustomerDetailsInput,
  UpdateCustomerDetailsToolResult
> = {
  name: 'update_customer_details',
  description:
    'Updates non-sensitive customer details (such as customer name, delivery address, city, or postal code) for the current conversation. Call this when the customer provides their delivery address or name.',
  inputSchema: updateCustomerDetailsInputSchema,
  classification: 'WRITE',
  capabilityRequired: 'contacts:update',
  sideEffect: 'MUTATION',
  idempotency: 'SAFE_TO_RETRY',
  riskLevel: 'LOW',
  auditRequired: true,
  handler: async (ctx: AITenantContext, input) => {
    // 1. Verify conversation and contact in tenant boundary
    const conversation = await findConversationById(
      prisma,
      ctx.workspaceId,
      ctx.conversationId,
    );

    if (!conversation || !conversation.contactId) {
      return {
        success: false,
        error: 'NOT_FOUND',
        message: 'Current conversation or customer contact not found.',
      };
    }

    const contact = await findContactById(
      prisma,
      ctx.workspaceId,
      conversation.contactId,
    );

    if (!contact) {
      return {
        success: false,
        error: 'NOT_FOUND',
        message: 'Customer record not found.',
      };
    }

    // 2. Build non-empty update payload
    const updateData: Record<string, string> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.addressLine1 !== undefined) updateData.addressLine1 = input.addressLine1;
    if (input.addressLine2 !== undefined) updateData.addressLine2 = input.addressLine2;
    if (input.city !== undefined) updateData.city = input.city;
    if (input.postalCode !== undefined) updateData.postalCode = input.postalCode;

    if (Object.keys(updateData).length === 0) {
      return {
        success: true,
        message: 'No details were provided to update.',
        contactId: contact.id,
        updatedFields: {},
      };
    }

    // 3. Perform scoped update
    const updatedCount = await updateContact(
      prisma,
      ctx.workspaceId,
      contact.id,
      updateData,
    );

    if (updatedCount === 0) {
      return {
        success: false,
        error: 'NOT_FOUND',
        message: 'Customer record could not be updated.',
      };
    }

    return {
      success: true,
      message: 'Customer details updated successfully.',
      contactId: contact.id,
      updatedFields: updateData,
    };
  },
};
