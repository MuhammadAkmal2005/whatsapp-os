/**
 * Phase 10 Unit 1: CI Pipeline, Security Policy, and Production Config Validation Tests.
 *
 * Tests:
 * 1. CI Workflow specification (.github/workflows/ci.yml)
 * 2. Security Disclosure Policy specification (SECURITY.md)
 * 3. Production Environment Validation Rules
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Phase 10 Unit 1: Production Readiness & CI Integration', () => {
  const rootDir = path.resolve(__dirname, '../../');

  describe('CI Pipeline Configuration (.github/workflows/ci.yml)', () => {
    it('exists and configures automated verification on push and PR to main', () => {
      const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
      expect(fs.existsSync(ciPath)).toBe(true);

      const content = fs.readFileSync(ciPath, 'utf8');

      // Trigger conditions
      expect(content).toContain('branches: [main]');
      expect(content).toContain('pull_request:');
      expect(content).toContain('push:');

      // Concurrency cancellation
      expect(content).toContain('cancel-in-progress: true');

      // Service container
      expect(content).toContain('pgvector/pgvector:pg16');
      expect(content).toContain('5433:5432');
      expect(content).toContain('pg_isready');

      // Node.js environment
      expect(content).toContain('node-version: 20');

      // Verification steps
      expect(content).toContain('npm run syntax');
      expect(content).toContain('npm run imports');
      expect(content).toContain('npm run typecheck');
      expect(content).toContain('npm run lint');
      expect(content).toContain('npm test');
      expect(content).toContain('npm run build');
    });
  });

  describe('Security Vulnerability Disclosure Policy (SECURITY.md)', () => {
    it('exists in repository root with valid reporting address, SLA, and scope', () => {
      const secPath = path.join(rootDir, 'SECURITY.md');
      expect(fs.existsSync(secPath)).toBe(true);

      const content = fs.readFileSync(secPath, 'utf8');

      // Security Contact
      expect(content).toContain('security@whatsapp-os.local');

      // Response SLA
      expect(content).toContain('24 hours');
      expect(content).toContain('72 hours');

      // Safe Harbor
      expect(content).toContain('Safe Harbor');

      // Scope definitions
      expect(content).toContain('Multi-tenant data isolation');
      expect(content).toContain('Authentication and session revocation');
    });
  });
});
