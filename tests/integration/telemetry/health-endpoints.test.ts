/**
 * Phase 9 Unit 3: Health Endpoints Integration Tests.
 *
 * Tests the real Next.js API route handlers for:
 * - GET /api/health (Overall health overview)
 * - GET /api/health/liveness (Liveness probe)
 * - GET /api/health/readiness (Readiness probe with live PostgreSQL and job queue)
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { GET as healthRoute } from '@/app/api/health/route';
import { GET as livenessRoute } from '@/app/api/health/liveness/route';
import { GET as readinessRoute } from '@/app/api/health/readiness/route';
import { resetDatabase } from '../fixtures';

describe('Phase 9 Unit 3: Health Probes Integration', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('GET /api/health/liveness', () => {
    it('returns status 200 with ok status and process uptime', async () => {
      const response = livenessRoute();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(typeof body.uptimeSeconds).toBe('number');
      expect(body.version).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/health/readiness', () => {
    it('returns status 200 with ready status when database and queue are live', async () => {
      const response = await readinessRoute();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('up');
      expect(body.checks.queue).toBe('up');
      expect(typeof body.latenciesMs.database).toBe('number');
      expect(typeof body.latenciesMs.queue).toBe('number');
    });
  });

  describe('GET /api/health', () => {
    it('returns status 200 with complete operational overview', async () => {
      const response = await healthRoute();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(['healthy', 'degraded']).toContain(body.status);
      expect(body.dependencies.database.status).toBe('up');
      expect(body.dependencies.queue.status).toBe('up');
      expect(body.system.memoryHeapUsedMb).toBeGreaterThan(0);
      expect(body.integrations).toBeDefined();
      expect(body.integrations.whatsapp).toBeDefined();
      expect(body.integrations.ai).toBeDefined();
    });
  });
});
