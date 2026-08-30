/**
 * Analytics validation schemas.
 *
 * Validates date ranges, grouping intervals, metric filters, and daily rollup parameters.
 */

import { z } from 'zod';

export const dateRangeQuerySchema = z.object({
  from: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  to: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  interval: z.enum(['day', 'week', 'month']).default('day'),
});

export type DateRangeQueryInput = z.infer<typeof dateRangeQuerySchema>;

export const aiTelemetryQuerySchema = z.object({
  from: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  to: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  agentId: z.string().uuid().optional(),
  model: z.string().optional(),
  source: z.enum(['CONVERSATION', 'PLAYGROUND', 'AUTOMATION']).optional(),
});

export type AITelemetryQueryInput = z.infer<typeof aiTelemetryQuerySchema>;

export const usageMeteringQuerySchema = z.object({
  periodKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Invalid period format (YYYY-MM)')
    .optional(),
});

export type UsageMeteringQueryInput = z.infer<typeof usageMeteringQuerySchema>;

export const rollupDailyInputSchema = z.object({
  date: z
    .string()
    .date()
    .or(z.string().datetime({ offset: true }))
    .or(z.date())
    .transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  workspaceId: z.string().uuid().optional(),
});

export type RollupDailyInput = z.infer<typeof rollupDailyInputSchema>;

export const exportAnalyticsReportSchema = z.object({
  from: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  to: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  reportType: z.enum(['overview', 'ai_telemetry', 'usage', 'daily_rollups']).default('overview'),
  format: z.enum(['csv', 'json']).default('csv'),
});

export type ExportAnalyticsReportInput = z.infer<typeof exportAnalyticsReportSchema>;
