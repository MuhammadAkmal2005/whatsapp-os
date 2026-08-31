import { z } from 'zod';

export const exportAuditLogSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  action: z.string().trim().max(100).optional(),
  actorType: z.enum(['USER', 'AI_AGENT', 'SYSTEM', 'AUTOMATION', 'CUSTOMER']).optional(),
  format: z.enum(['csv', 'json']).default('csv'),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

export type ExportAuditLogInput = z.input<typeof exportAuditLogSchema>;

