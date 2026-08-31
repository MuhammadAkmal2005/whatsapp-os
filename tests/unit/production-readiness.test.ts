/**
 * Phase 10 Unit 3: Master Production Readiness & Deployment Verification Suite.
 *
 * Tests:
 * 1. Environment & Secret Audit Rules (AUTH_SECRET entropy, production safety guards)
 * 2. Database Schema & Multi-Tenant Scoping Audit (52 models, workspaceId presence, migration integrity)
 * 3. Security Hardening & Headers Audit (CSP, HSTS, Frameguard, Permissions-Policy)
 * 4. Health, Metrics & Observability Probes Audit (/api/health, /api/metrics, /api/audit/export)
 * 5. Background Worker & Async Queue Handlers Audit (all 9 job handlers registered)
 * 6. Backup & Disaster Recovery Tools Audit (SHA-256 verification, PITR runbook)
 * 7. Master Production Pre-flight Report Generation & Status Evaluation
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  auditEnvironment,
  auditDatabaseSchema,
  auditSecurityHardening,
  auditObservability,
  auditWorkerAndHandlers,
  auditDisasterRecovery,
  runProductionReadinessAudit,
} from '../../tools/production-readiness';

describe('Phase 10 Unit 3: Master Production Readiness & Deployment Verification Gate', () => {
  const rootDir = resolve(process.cwd());

  describe('1. Environment & Secret Invariants Audit', () => {
    it('passes audit for a fully-configured, valid production environment', () => {
      const validProdEnv = {
        NODE_ENV: 'production',
        APP_URL: 'https://app.whatsapp-os.example.com',
        AUTH_SECRET: 'dGVzdC1hdXRoLXNlY3JldC12YWxpZC1lbnRyb3B5LTMyaGV4LWtleXMxMjM=',
        DATABASE_URL: 'postgresql://prod_user:secret_pass@db.internal:5432/whatsapp_os_prod?sslmode=require',
        MOCK_WHATSAPP: 'false',
        WHATSAPP_ACCESS_TOKEN: 'EAAG_test_access_token_production',
        WHATSAPP_PHONE_NUMBER_ID: '109876543210',
        WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098',
        WHATSAPP_VERIFY_TOKEN: 'meta_webhook_verification_token_123',
        META_APP_SECRET: 'meta_app_secret_signature_key',
        STORAGE_PROVIDER: 's3',
        STORAGE_ENDPOINT: 'https://s3.eu-central-1.amazonaws.com',
        STORAGE_ACCESS_KEY: 'AKIAIOSFODNN7EXAMPLE',
        STORAGE_SECRET_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        STORAGE_BUCKET: 'whatsapp-os-prod-media',
        AI_PROVIDER: 'gemini',
        AI_API_KEY: 'test_gemini_api_key_valid_production',
        LOG_FORMAT: 'json',
      };

      const checks = auditEnvironment(validProdEnv, { isStrictProduction: true });
      const blockers = checks.filter((c) => c.status === 'BLOCKER');
      const warnings = checks.filter((c) => c.status === 'WARN');

      expect(blockers).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });

    it('blocks deployment if AUTH_SECRET is missing or shorter than 32 characters', () => {
      const missingSecret = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://localhost:5432/db' };
      const checksMissing = auditEnvironment(missingSecret, { isStrictProduction: true });
      expect(checksMissing.some((c) => c.id === 'env_auth_secret_present' && c.status === 'BLOCKER')).toBe(true);

      const shortSecret = {
        NODE_ENV: 'production',
        AUTH_SECRET: 'too_short_key',
        DATABASE_URL: 'postgresql://localhost:5432/db',
      };
      const checksShort = auditEnvironment(shortSecret, { isStrictProduction: true });
      expect(checksShort.some((c) => c.id === 'env_auth_secret_length' && c.status === 'BLOCKER')).toBe(true);
    });

    it('blocks deployment if AUTH_SECRET is a trivial repeating string or placeholder', () => {
      const trivialSecret = {
        NODE_ENV: 'production',
        AUTH_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        DATABASE_URL: 'postgresql://localhost:5432/db',
      };
      const checksTrivial = auditEnvironment(trivialSecret, { isStrictProduction: true });
      expect(checksTrivial.some((c) => c.id === 'env_auth_secret_entropy' && c.status === 'BLOCKER')).toBe(true);
    });

    it('blocks deployment if MOCK_WHATSAPP=true is set in production', () => {
      const mockInProd = {
        NODE_ENV: 'production',
        AUTH_SECRET: 'dGVzdC1hdXRoLXNlY3JldC12YWxpZC1lbnRyb3B5LTMyaGV4LWtleXMxMjM=',
        DATABASE_URL: 'postgresql://localhost:5432/db',
        MOCK_WHATSAPP: 'true',
        STORAGE_PROVIDER: 's3',
        STORAGE_ENDPOINT: 'https://s3.amazonaws.com',
        STORAGE_ACCESS_KEY: 'key',
        STORAGE_SECRET_KEY: 'secret',
      };
      const checks = auditEnvironment(mockInProd, { isStrictProduction: true });
      expect(checks.some((c) => c.id === 'env_mock_whatsapp_prod' && c.status === 'BLOCKER')).toBe(true);
    });

    it('blocks deployment if STORAGE_PROVIDER=local is set in production', () => {
      const localInProd = {
        NODE_ENV: 'production',
        AUTH_SECRET: 'dGVzdC1hdXRoLXNlY3JldC12YWxpZC1lbnRyb3B5LTMyaGV4LWtleXMxMjM=',
        DATABASE_URL: 'postgresql://localhost:5432/db',
        MOCK_WHATSAPP: 'false',
        WHATSAPP_ACCESS_TOKEN: 'token',
        WHATSAPP_PHONE_NUMBER_ID: 'id',
        WHATSAPP_BUSINESS_ACCOUNT_ID: 'waba',
        WHATSAPP_VERIFY_TOKEN: 'vtoken',
        META_APP_SECRET: 'secret',
        STORAGE_PROVIDER: 'local',
      };
      const checks = auditEnvironment(localInProd, { isStrictProduction: true });
      expect(checks.some((c) => c.id === 'env_storage_provider_prod' && c.status === 'BLOCKER')).toBe(true);
    });
  });

  describe('2. Database & Schema Multi-Tenant Scoping Audit', () => {
    it('verifies all 52 schema models exist and enforce tenant boundaries', () => {
      const checks = auditDatabaseSchema(rootDir);
      const blockers = checks.filter((c) => c.status === 'BLOCKER');

      expect(blockers).toHaveLength(0);
      expect(checks.some((c) => c.id === 'db_model_count' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'db_tenant_isolation' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'db_migrations_integrity' && c.status === 'PASS')).toBe(true);
    });
  });

  describe('3. Security Hardening & HTTP Headers Audit', () => {
    it('verifies all defense-in-depth security headers are defined and wired globally', () => {
      const checks = auditSecurityHardening(rootDir);
      const blockers = checks.filter((c) => c.status === 'BLOCKER');

      expect(blockers).toHaveLength(0);
      expect(checks.some((c) => c.id === 'sec_headers_completeness' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'sec_next_headers_attachment' && c.status === 'PASS')).toBe(true);
    });
  });

  describe('4. Observability & Health Probes Audit', () => {
    it('verifies health probes, Prometheus metrics, and audit export endpoints exist', () => {
      const checks = auditObservability(rootDir);
      const blockers = checks.filter((c) => c.status === 'BLOCKER');

      expect(blockers).toHaveLength(0);
      expect(checks.some((c) => c.id === 'obs_health_probes' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'obs_prometheus_metrics' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'obs_audit_export' && c.status === 'PASS')).toBe(true);
    });
  });

  describe('5. Background Worker & Async Queue Handlers Audit', () => {
    it('verifies worker entry point and all 9 registered job handlers', () => {
      const checks = auditWorkerAndHandlers(rootDir);
      const blockers = checks.filter((c) => c.status === 'BLOCKER');

      expect(blockers).toHaveLength(0);
      expect(checks.some((c) => c.id === 'worker_entry_point' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'worker_handler_registry' && c.status === 'PASS')).toBe(true);
    });
  });

  describe('6. Disaster Recovery & Backup Tooling Audit', () => {
    it('verifies backup/restore CLI utilities and operational runbook SLA definitions', () => {
      const checks = auditDisasterRecovery(rootDir);
      const blockers = checks.filter((c) => c.status === 'BLOCKER');

      expect(blockers).toHaveLength(0);
      expect(checks.some((c) => c.id === 'dr_backup_tooling' && c.status === 'PASS')).toBe(true);
      expect(checks.some((c) => c.id === 'dr_operational_runbook' && c.status === 'PASS')).toBe(true);
    });
  });

  describe('7. Master Pre-flight Audit Execution & Status', () => {
    it('executes master audit report generator and correctly evaluates status', () => {
      const report = runProductionReadinessAudit(rootDir);

      expect(report.timestamp).toBeDefined();
      expect(report.summary.total).toBeGreaterThanOrEqual(10);
      expect(['READY', 'WARNINGS', 'BLOCKED']).toContain(report.overallStatus);
      expect(report.summary.passed).toBeGreaterThan(0);
    });
  });
});
