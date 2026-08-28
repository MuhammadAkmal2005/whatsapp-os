/**
 * Validation schemas for WhatsApp Business Account management.
 *
 * Backs both the client settings forms and server actions to ensure consistent validation.
 */

import { z } from 'zod';

export const connectWhatsAppSchema = z.object({
  wabaId: z
    .string()
    .trim()
    .min(1, 'Meta WhatsApp Business Account ID (WABA ID) is required.')
    .max(128, 'WABA ID is too long.'),
  phoneNumberId: z
    .string()
    .trim()
    .min(1, 'Meta Phone Number ID is required.')
    .max(128, 'Phone Number ID is too long.'),
  displayPhoneNumber: z
    .string()
    .trim()
    .min(1, 'Display phone number is required.')
    .max(32, 'Display phone number is too long.'),
  accessToken: z
    .string()
    .trim()
    .min(1, 'System User Access Token is required.')
    .max(1024, 'Access token is too long.'),
  displayName: z
    .string()
    .trim()
    .max(128, 'Display name is too long.')
    .optional()
    .nullable(),
});

export const disconnectWhatsAppSchema = z.object({
  accountId: z.string().uuid('Invalid account ID.'),
});

export type ConnectWhatsAppInput = z.infer<typeof connectWhatsAppSchema>;
export type DisconnectWhatsAppInput = z.infer<typeof disconnectWhatsAppSchema>;
