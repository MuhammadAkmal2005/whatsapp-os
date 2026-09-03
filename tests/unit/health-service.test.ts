/**
 * Phase 9 Unit 3: Health and Readiness Service Unit Tests.
 *
 * Tests:
 * - Deterministic liveness probe output
 * - Readiness checks with simulated healthy and failing dependencies
 * - Proper HTTP status codes (200 vs 503)
 * - Zero secrets / credential leakage in health responses
 * - Comprehensive health overview formatting
 */

import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db/prisma';
import type { JobQueue, QueueStats } from '@/server/jobs/queue';
import {
  checkLiveness,
  checkReadiness,
  getHealthOverview,
} from '@/server/services/health/health.service';

describe('Phase 9 Unit 3: Health & Readiness Service', () => {
  describe('checkLiveness', () => {
    it('returns deterministic ok status with uptime and ISO timestamp', () => {
      const result = checkLiveness();
      expect(result.status).toBe('ok');
      expect(typeof result.uptimeSeconds).toBe('number');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
      expect(result.version).toBe('1.0.0');
    });
  });

  describe('checkReadiness', () => {
    it('returns status 200 and ready when database and queue are reachable', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as unknown as Db;

      const mockQueue = {
        stats: vi.fn().mockResolvedValue({
          pending: 2,
          running: 1,
          dead: 0,
          oldestPendingAgeSeconds: 15,
        } as QueueStats),
      } as unknown as JobQueue;

      const res = await checkReadiness(mockDb, mockQueue);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database).toBe('up');
      expect(res.body.checks.queue).toBe('up');
      expect(res.body.latenciesMs.database).toBeGreaterThanOrEqual(0);
      expect(res.body.latenciesMs.queue).toBeGreaterThanOrEqual(0);
    });

    it('returns status 503 and unhealthy when database check fails without leaking credentials', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('Connection refused: postgresql://secret_user:super_secret_password@db.example.com:5432/db')),
      } as unknown as Db;

      const mockQueue = {
        stats: vi.fn().mockResolvedValue({
          pending: 0,
          running: 0,
          dead: 0,
          oldestPendingAgeSeconds: null,
        } as QueueStats),
      } as unknown as JobQueue;

      const res = await checkReadiness(mockDb, mockQueue);

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.checks.database).toBe('down');
      expect(res.body.checks.queue).toBe('up');

      // CRITICAL: Ensure no secrets, usernames, or connection URLs leak into response JSON
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('super_secret_password');
      expect(serialized).not.toContain('secret_user');
      expect(serialized).not.toContain('postgresql://');
    });

    it('returns status 503 and unhealthy when job queue check fails', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as unknown as Db;

      const mockQueue = {
        stats: vi.fn().mockRejectedValue(new Error('Queue lock timeout')),
      } as unknown as JobQueue;

      const res = await checkReadiness(mockDb, mockQueue);

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.checks.database).toBe('up');
      expect(res.body.checks.queue).toBe('down');
    });
  });

  describe('getHealthOverview', () => {
    it('provides comprehensive operational health metrics and integration status', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as unknown as Db;

      const mockQueue = {
        stats: vi.fn().mockResolvedValue({
          pending: 5,
          running: 2,
          dead: 1,
          oldestPendingAgeSeconds: 30,
        } as QueueStats),
      } as unknown as JobQueue;

      const res = await getHealthOverview(mockDb, mockQueue);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.system.memoryHeapUsedMb).toBeGreaterThan(0);
      expect(res.body.system.nodeVersion).toBeDefined();
      expect(res.body.dependencies.queue.stats?.pending).toBe(5);
      expect(res.body.dependencies.queue.stats?.running).toBe(2);
      expect(res.body.dependencies.queue.stats?.dead).toBe(1);
      expect(res.body.integrations).toBeDefined();
      expect(['mock', 'live']).toContain(res.body.integrations.whatsapp);
      expect(['local', 's3']).toContain(res.body.integrations.storage);
    });

    it('probes the job queue once per request rather than once per reported field', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as unknown as Db;

      const stats = vi.fn().mockResolvedValue({
        pending: 0,
        running: 0,
        dead: 0,
        oldestPendingAgeSeconds: null,
      } as QueueStats);

      await getHealthOverview(mockDb, { stats } as unknown as JobQueue);

      // `stats()` is itself two queries. Calling it twice made a health check cost
      // five queries to report on three dependencies.
      expect(stats).toHaveBeenCalledTimes(1);
    });

    it('attributes connect cost separately from query cost', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as unknown as Db;

      const mockQueue = {
        stats: vi.fn().mockResolvedValue({
          pending: 0,
          running: 0,
          dead: 0,
          oldestPendingAgeSeconds: null,
        } as QueueStats),
      } as unknown as JobQueue;

      const res = await getHealthOverview(mockDb, mockQueue);
      const database = res.body.dependencies.database;

      expect(database.queryMs).toBeGreaterThanOrEqual(0);
      expect(database.latencyMs).toBeGreaterThanOrEqual(database.queryMs);
      // The injected fake exposes no `$connect`, so there is no handshake to attribute.
      expect(database.connectMs).toBeNull();
      expect(typeof database.warm).toBe('boolean');
    });

    it('reports connection configuration as derived facts, never as a connection string', async () => {
      const mockDb = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      } as unknown as Db;

      const mockQueue = {
        stats: vi.fn().mockResolvedValue({
          pending: 0,
          running: 0,
          dead: 0,
          oldestPendingAgeSeconds: null,
        } as QueueStats),
      } as unknown as JobQueue;

      const res = await getHealthOverview(mockDb, mockQueue);

      expect(typeof res.body.connection.pooled).toBe('boolean');
      expect(typeof res.body.connection.pgbouncerFlag).toBe('boolean');
      expect(res.body.system.cpuCount).toBeGreaterThan(0);
      expect(res.body.connection.cpuCount).toBe(res.body.system.cpuCount);

      // CRITICAL: the connection block is derived from DATABASE_URL, so it is the
      // one place a credential could plausibly reach a public response body.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('postgresql://');
      expect(serialized).not.toContain('whatsapp_os');
      expect(serialized).not.toContain('localhost');
    });
  });
});
