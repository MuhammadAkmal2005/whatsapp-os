import { describe, expect, it } from 'vitest';
import {
  aiTelemetryQuerySchema,
  dateRangeQuerySchema,
  rollupDailyInputSchema,
  usageMeteringQuerySchema,
} from '@/server/validation/analytics';

describe('Analytics Server Actions & Validation Unit Tests', () => {
  it('validates date range query schemas with ISO and date strings', () => {
    const valid = dateRangeQuerySchema.safeParse({
      from: '2026-08-01',
      to: '2026-08-31',
      interval: 'day',
    });

    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.from).toBeInstanceOf(Date);
      expect(valid.data.to).toBeInstanceOf(Date);
      expect(valid.data.interval).toBe('day');
    }
  });

  it('handles optional parameters in dateRangeQuerySchema', () => {
    const validEmpty = dateRangeQuerySchema.safeParse({});
    expect(validEmpty.success).toBe(true);
    if (validEmpty.success) {
      expect(validEmpty.data.from).toBeUndefined();
      expect(validEmpty.data.to).toBeUndefined();
      expect(validEmpty.data.interval).toBe('day');
    }
  });

  it('validates AI telemetry query schema filters', () => {
    const valid = aiTelemetryQuerySchema.safeParse({
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
      model: 'gemini-2.5-flash',
      source: 'CONVERSATION',
    });

    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.model).toBe('gemini-2.5-flash');
      expect(valid.data.source).toBe('CONVERSATION');
    }
  });

  it('validates usage metering query schema with valid period key', () => {
    const valid = usageMeteringQuerySchema.safeParse({
      periodKey: '2026-08',
    });

    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.periodKey).toBe('2026-08');
    }
  });

  it('validates daily rollup action input schemas', () => {
    const valid = rollupDailyInputSchema.safeParse({
      date: '2026-08-30',
      workspaceId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.date).toBeInstanceOf(Date);
      expect(valid.data.workspaceId).toBe('123e4567-e89b-12d3-a456-426614174000');
    }
  });
});
