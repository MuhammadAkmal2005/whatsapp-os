import { describe, expect, it } from 'vitest';

import { estimateCostMicros, estimateEmbeddingCostMicros } from '@/config/models';
import { checkLimit, getPlan } from '@/config/plans';
import {
  aiTelemetryQuerySchema,
  dateRangeQuerySchema,
  rollupDailyInputSchema,
} from '@/server/validation/analytics';

describe('Analytics validation schemas', () => {
  it('parses valid date range inputs', () => {
    const parsed = dateRangeQuerySchema.parse({
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T23:59:59Z',
      interval: 'day',
    });

    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
    expect(parsed.interval).toBe('day');
  });

  it('parses date-only strings and applies interval default', () => {
    const parsed = dateRangeQuerySchema.parse({
      from: '2026-08-01',
      to: '2026-08-30',
    });

    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
    expect(parsed.interval).toBe('day');
  });

  it('parses AI telemetry filters with uuid and source', () => {
    const agentId = '11111111-2222-3333-4444-555555555555';
    const parsed = aiTelemetryQuerySchema.parse({
      agentId,
      model: 'gemini-2.5-flash',
      source: 'CONVERSATION',
    });

    expect(parsed.agentId).toBe(agentId);
    expect(parsed.model).toBe('gemini-2.5-flash');
    expect(parsed.source).toBe('CONVERSATION');
  });

  it('rejects invalid UUID in AI telemetry filters', () => {
    expect(() =>
      aiTelemetryQuerySchema.parse({
        agentId: 'invalid-not-a-uuid',
      }),
    ).toThrow();
  });

  it('parses daily rollup job input', () => {
    const parsed = rollupDailyInputSchema.parse({
      date: '2026-08-30',
    });

    expect(parsed.date).toBeInstanceOf(Date);
  });
});

describe('AI cost attribution and models', () => {
  it('calculates cost in micros accurately for gpt-4o-mini', () => {
    // 1,000 input tokens at $0.15/1M ($0.00015) = 150 micros
    // 1,000 output tokens at $0.60/1M ($0.00060) = 600 micros
    // Total = 750 micros
    const cost = estimateCostMicros('gpt-4o-mini', 1000, 1000);
    expect(cost).toBe(750);
  });

  it('returns 0 cost for mock model in dev/tests', () => {
    const cost = estimateCostMicros('mock-model', 5000, 5000);
    expect(cost).toBe(0);
  });

  it('reports an unknown cost rather than inventing one for an uncatalogued model', () => {
    // A missing price must never break a customer reply, and must never be
    // silently substituted with another model's rate. The registry's own
    // behaviour is covered in model-registry.test.ts; this asserts the shape the
    // metering layer depends on.
    expect(estimateCostMicros('unknown-future-model', 1000, 1000)).toBeNull();
  });

  it('calculates embedding cost in micros', () => {
    // 100,000 tokens at $0.02/1M = $0.002 = 2000 micros
    const cost = estimateEmbeddingCostMicros('text-embedding-3-small', 100_000);
    expect(cost).toBe(2000);
  });
});

describe('Plan limits and usage metering checks', () => {
  it('correctly reports unmetered limits for pro plans', () => {
    const proPlan = getPlan('pro');
    expect(proPlan.limits.aiRequestsPerMonth).toBeNull();

    const check = checkLimit('pro', 'aiRequestsPerMonth', 50_000);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBeNull();
    expect(check.ratio).toBe(0);
    expect(check.nearLimit).toBe(false);
  });

  it('evaluates limits and near-limit thresholds on free tier', () => {
    // Free plan has 100 aiRequestsPerMonth
    const checkUnder = checkLimit('free', 'aiRequestsPerMonth', 50);
    expect(checkUnder.allowed).toBe(true);
    expect(checkUnder.remaining).toBe(50);
    expect(checkUnder.ratio).toBe(0.5);
    expect(checkUnder.nearLimit).toBe(false);

    // At 85/100 -> near limit warning
    const checkNear = checkLimit('free', 'aiRequestsPerMonth', 85);
    expect(checkNear.allowed).toBe(true);
    expect(checkNear.remaining).toBe(15);
    expect(checkNear.ratio).toBe(0.85);
    expect(checkNear.nearLimit).toBe(true);

    // At 100/100 -> allowed is false for +1 request
    const checkExceeded = checkLimit('free', 'aiRequestsPerMonth', 100, 1);
    expect(checkExceeded.allowed).toBe(false);
    expect(checkExceeded.remaining).toBe(0);
    expect(checkExceeded.ratio).toBe(1);
    expect(checkExceeded.nearLimit).toBe(true);
  });
});
