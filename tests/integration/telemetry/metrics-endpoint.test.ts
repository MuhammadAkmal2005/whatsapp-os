/**
 * Phase 9 Unit 3: Metrics Exporter Endpoint Integration Tests.
 *
 * Tests the real Next.js API route handler for:
 * - GET /api/metrics (Prometheus text format)
 * - GET /api/metrics?format=json (Structured JSON format)
 * - Proper content-type headers and cache-control headers
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as metricsRoute } from '@/app/api/metrics/route';
import { metricsRegistry } from '@/server/telemetry/metrics';

describe('Phase 9 Unit 3: Metrics Exporter Integration', () => {
  beforeEach(() => {
    metricsRegistry.reset();
  });

  it('exposes Prometheus compliant text format by default', async () => {
    metricsRegistry.httpRequests.inc({ method: 'GET', path: '/api/health', status: 200 }, 5);
    metricsRegistry.rateLimitHits.inc({ tier: 'auth' }, 2);

    const req = new NextRequest('http://localhost:3000/api/metrics');
    const response = metricsRoute(req);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');

    const text = await response.text();
    expect(text).toContain('# HELP http_requests_total');
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('http_requests_total{method="GET",path="/api/health",status="200"} 5');
    expect(text).toContain('rate_limit_hits_total{tier="auth"} 2');
  });

  it('returns structured JSON format when format=json query parameter is supplied', async () => {
    metricsRegistry.webhookEvents.inc({ provider: 'whatsapp', eventType: 'messages', status: 'RECEIVED' }, 3);

    const req = new NextRequest('http://localhost:3000/api/metrics?format=json');
    const response = metricsRoute(req);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');

    const json = await response.json();
    expect(json.webhookEvents).toBeDefined();
    expect(json.webhookEvents).toEqual([
      { labels: { provider: 'whatsapp', eventType: 'messages', status: 'RECEIVED' }, value: 3 },
    ]);
  });

  it('returns structured JSON format when Accept: application/json header is provided', async () => {
    metricsRegistry.aiTokens.inc({ model: 'gpt-4o-mini', type: 'output' }, 500);

    const req = new NextRequest('http://localhost:3000/api/metrics', {
      headers: { Accept: 'application/json' },
    });
    const response = metricsRoute(req);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');

    const json = await response.json();
    expect(json.aiTokens).toEqual([
      { labels: { model: 'gpt-4o-mini', type: 'output' }, value: 500 },
    ]);
  });
});
