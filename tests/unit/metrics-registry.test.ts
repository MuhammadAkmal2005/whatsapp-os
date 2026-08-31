/**
 * Phase 9 Unit 3: Metrics Registry Unit Tests.
 *
 * Tests:
 * - Counter incrementing and label serialization
 * - Gauge set, increment, and decrement
 * - Histogram observation and bucket calculation
 * - Prometheus text exposition format compliance
 * - Cardinality protection and path normalization
 * - Safe JSON serialization
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  normalizeMetricPath,
} from '@/server/telemetry/metrics';

describe('Phase 9 Unit 3: Metrics Registry', () => {
  describe('Counter', () => {
    it('increments with and without labels', () => {
      const counter = new Counter('test_total', 'A test counter', ['status']);
      expect(counter.get({ status: 'success' })).toBe(0);

      counter.inc({ status: 'success' });
      counter.inc({ status: 'success' }, 4);
      expect(counter.get({ status: 'success' })).toBe(5);

      counter.inc({ status: 'error' }, 2);
      expect(counter.get({ status: 'error' })).toBe(2);
      expect(counter.get({ status: 'success' })).toBe(5);
    });

    it('rejects negative increments', () => {
      const counter = new Counter('test_total', 'A test counter');
      expect(() => counter.inc(undefined, -1)).toThrow();
    });

    it('handles cardinality limits gracefully with overflow bucket', () => {
      const counter = new Counter('test_cardinality', 'Test limit', ['id'], 3);
      counter.inc({ id: '1' });
      counter.inc({ id: '2' });
      counter.inc({ id: '3' });
      // Exceeds max combinations
      counter.inc({ id: '4' });
      counter.inc({ id: '5' });

      expect(counter.get({ id: '1' })).toBe(1);
      expect(counter.get({ id: '2' })).toBe(1);
      expect(counter.get({ id: '3' })).toBe(1);
      expect(counter.get({ overflow: 'true' })).toBe(2);
    });
  });

  describe('Gauge', () => {
    it('sets, increments, and decrements values correctly', () => {
      const gauge = new Gauge('queue_depth', 'Queue depth gauge', ['status']);
      gauge.set(10, { status: 'pending' });
      expect(gauge.get({ status: 'pending' })).toBe(10);

      gauge.inc({ status: 'pending' }, 5);
      expect(gauge.get({ status: 'pending' })).toBe(15);

      gauge.dec({ status: 'pending' }, 3);
      expect(gauge.get({ status: 'pending' })).toBe(12);
    });
  });

  describe('Histogram', () => {
    it('records observations across buckets and calculates sum and count', () => {
      const histogram = new Histogram('request_duration', 'Latency', ['route'], [0.1, 0.5, 1.0]);
      histogram.observe(0.05, { route: 'home' });
      histogram.observe(0.2, { route: 'home' });
      histogram.observe(0.8, { route: 'home' });
      histogram.observe(1.5, { route: 'home' });

      const collected = histogram.collect();
      expect(collected).toHaveLength(1);
      const val = collected[0];
      expect(val).toBeDefined();
      expect(val?.count).toBe(4);
      expect(val?.sum).toBeCloseTo(2.55, 2);
      expect(val?.bucketCounts.get(0.1)).toBe(1); // 0.05
      expect(val?.bucketCounts.get(0.5)).toBe(2); // 0.05, 0.2
      expect(val?.bucketCounts.get(1.0)).toBe(3); // 0.05, 0.2, 0.8
    });
  });

  describe('Path Normalization (Cardinality Protection)', () => {
    it('normalizes known API routes and replaces UUIDs / numeric IDs', () => {
      expect(normalizeMetricPath('/api/webhooks/whatsapp?hub.mode=subscribe')).toBe('/api/webhooks/whatsapp');
      expect(normalizeMetricPath('/api/webhooks/billing/')).toBe('/api/webhooks/billing');
      expect(normalizeMetricPath('/api/health')).toBe('/api/health');
      expect(normalizeMetricPath('/api/health/readiness')).toBe('/api/health/readiness');
      expect(normalizeMetricPath('/api/metrics')).toBe('/api/metrics');

      // UUID normalization
      expect(
        normalizeMetricPath('/conversations/123e4567-e89b-12d3-a456-426614174000/messages'),
      ).toBe('/conversations/:id/messages');

      // Numeric ID normalization
      expect(normalizeMetricPath('/products/98765/variants/123')).toBe('/products/:id/variants/:id');
    });
  });

  describe('MetricsRegistry & Prometheus Exposition Format', () => {
    let registry: MetricsRegistry;

    beforeEach(() => {
      registry = new MetricsRegistry();
    });

    it('generates standard Prometheus text with HELP, TYPE, and serialized labels', () => {
      registry.httpRequests.inc({ method: 'GET', path: '/api/health', status: 200 });
      registry.jobQueueDepth.set(4, { status: 'pending' });
      registry.aiTokens.inc({ model: 'gpt-4o-mini', type: 'input' }, 150);

      const prometheusOutput = registry.toPrometheusText();

      expect(prometheusOutput).toContain('# HELP http_requests_total Total HTTP requests processed');
      expect(prometheusOutput).toContain('# TYPE http_requests_total counter');
      expect(prometheusOutput).toContain('http_requests_total{method="GET",path="/api/health",status="200"} 1');

      expect(prometheusOutput).toContain('# HELP job_queue_depth Current background job queue depth by status');
      expect(prometheusOutput).toContain('# TYPE job_queue_depth gauge');
      expect(prometheusOutput).toContain('job_queue_depth{status="pending"} 4');

      expect(prometheusOutput).toContain('ai_tokens_total{model="gpt-4o-mini",type="input"} 150');
      expect(prometheusOutput).toContain('process_uptime_seconds');
      expect(prometheusOutput).toContain('process_heap_bytes');
    });

    it('exports structured JSON representation', () => {
      registry.httpRequests.inc({ method: 'POST', path: '/api/webhooks/whatsapp', status: 200 }, 3);
      const json = registry.toJSON();

      expect(json.httpRequests).toEqual([
        { labels: { method: 'POST', path: '/api/webhooks/whatsapp', status: 200 }, value: 3 },
      ]);
      expect(typeof json.processUptimeSeconds).toBe('number');
      expect(typeof json.processHeapBytes).toBe('number');
    });
  });
});
