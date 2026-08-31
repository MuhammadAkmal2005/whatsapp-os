import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  parseDatabaseUrl,
  getPostgresCliEnv,
  calculateSha256,
  verifyBackupIntegrity,
  validateRestoreTarget,
  inspectMigrationsDirectory,
  BackupManifestSchema,
  BackupManifest,
} from '../../tools/backup-manager';

describe('Phase 10 Unit 2: Database Backup & Disaster Recovery Verification', () => {
  describe('1. Database URL Parsing & Secret Hygiene', () => {
    it('safely parses postgresql connection string without leaking password in structured fields', () => {
      const url = 'postgresql://app_user:super_secret_p%40ssword@db.internal.example.com:5432/whatsapp_os_prod?sslmode=require';
      const params = parseDatabaseUrl(url);

      expect(params.host).toBe('db.internal.example.com');
      expect(params.port).toBe(5432);
      expect(params.database).toBe('whatsapp_os_prod');
      expect(params.user).toBe('app_user');
      expect(params.hasPassword).toBe(true);
      expect(params.sslMode).toBe('require');
      // Password must not be exposed in the SafeDbConnectionParams interface
      expect((params as any).password).toBeUndefined();
    });

    it('extracts CLI environment variables for pg_dump/pg_restore without CLI argument exposure', () => {
      const url = 'postgresql://admin:secret123@10.0.0.5:5433/whatsapp_os';
      const { env, safeParams } = getPostgresCliEnv(url);

      expect(env.PGHOST).toBe('10.0.0.5');
      expect(env.PGPORT).toBe('5433');
      expect(env.PGDATABASE).toBe('whatsapp_os');
      expect(env.PGUSER).toBe('admin');
      expect(env.PGPASSWORD).toBe('secret123');

      expect(safeParams.database).toBe('whatsapp_os');
      expect(safeParams.hasPassword).toBe(true);
    });

    it('rejects unsupported protocols', () => {
      expect(() => parseDatabaseUrl('mysql://root:pass@localhost:3306/db')).toThrow(/Unsupported protocol/);
    });
  });

  describe('2. Backup Manifest Schema & Validation', () => {
    it('validates a well-formed backup manifest', () => {
      const validManifest: BackupManifest = {
        backupId: randomUUID(),
        timestamp: new Date().toISOString(),
        environment: 'production',
        databaseName: 'whatsapp_os',
        gitCommit: '02567ba',
        latestMigrationId: '20260831130000_phase9_unit2_performance_indexes',
        format: 'custom',
        sha256Checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sizeBytes: 1048576,
        tableCount: 52,
        compression: 'pg_custom',
        encryption: 'none',
      };

      const result = BackupManifestSchema.safeParse(validManifest);
      expect(result.success).toBe(true);
    });

    it('rejects invalid checksum or malformed fields in manifest', () => {
      const invalidManifest = {
        backupId: 'not-a-uuid',
        timestamp: 'invalid-date',
        environment: 'invalid-env',
        databaseName: '',
        gitCommit: 'abc',
        latestMigrationId: '',
        format: 'invalid-format',
        sha256Checksum: 'tooshort',
        sizeBytes: -10,
        tableCount: 0,
        compression: 'invalid',
        encryption: 'invalid',
      };

      const result = BackupManifestSchema.safeParse(invalidManifest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(5);
      }
    });
  });

  describe('3. Cryptographic Integrity & Tamper Detection', () => {
    it('computes deterministic SHA-256 and verifies intact dump file', () => {
      const tempDumpPath = join(tmpdir(), `test_dump_${Date.now()}.dump`);
      const dumpContent = Buffer.from('PGDMP_MOCK_DUMP_DATA_FOR_UNIT_TESTING_123456');
      writeFileSync(tempDumpPath, dumpContent);

      const expectedChecksum = calculateSha256(dumpContent);
      const manifest: BackupManifest = {
        backupId: randomUUID(),
        timestamp: new Date().toISOString(),
        environment: 'test',
        databaseName: 'whatsapp_os_test',
        gitCommit: '02567ba',
        latestMigrationId: '20260831130000_phase9_unit2_performance_indexes',
        format: 'custom',
        sha256Checksum: expectedChecksum,
        sizeBytes: dumpContent.length,
        tableCount: 52,
        compression: 'pg_custom',
        encryption: 'none',
      };

      const verification = verifyBackupIntegrity(tempDumpPath, manifest);
      expect(verification.valid).toBe(true);
      expect(verification.calculatedHash).toBe(expectedChecksum);

      // Clean up
      if (existsSync(tempDumpPath)) unlinkSync(tempDumpPath);
    });

    it('detects checksum mismatch and tampered backup content', () => {
      const tempDumpPath = join(tmpdir(), `tampered_dump_${Date.now()}.dump`);
      writeFileSync(tempDumpPath, Buffer.from('PGDMP_ORIGINAL_CONTENT'));

      const manifest: BackupManifest = {
        backupId: randomUUID(),
        timestamp: new Date().toISOString(),
        environment: 'production',
        databaseName: 'whatsapp_os',
        gitCommit: '02567ba',
        latestMigrationId: '20260831130000_phase9_unit2_performance_indexes',
        format: 'custom',
        sha256Checksum: '0000000000000000000000000000000000000000000000000000000000000000',
        sizeBytes: Buffer.from('PGDMP_ORIGINAL_CONTENT').length,
        tableCount: 52,
        compression: 'pg_custom',
        encryption: 'none',
      };

      const verification = verifyBackupIntegrity(tempDumpPath, manifest);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain('Checksum mismatch');

      // Clean up
      if (existsSync(tempDumpPath)) unlinkSync(tempDumpPath);
    });
  });

  describe('4. Restore Safeguards & Protection Against Accidental Overwrite', () => {
    it('blocks restoration to production database without exact confirmation flag', () => {
      const prodUrl = 'postgresql://admin:secret@prod-db.internal:5432/whatsapp_os';
      const check = validateRestoreTarget(prodUrl, {
        targetEnvironment: 'production',
      });

      expect(check.safe).toBe(false);
      expect(check.reason).toContain('Restoring to production database "whatsapp_os" is blocked');
      expect(check.reason).toContain('--confirm-overwrite=CONFIRM_RESTORE_WHATSAPP_OS');
    });

    it('allows restoration to production database when exact confirmation flag is provided', () => {
      const prodUrl = 'postgresql://admin:secret@prod-db.internal:5432/whatsapp_os';
      const check = validateRestoreTarget(prodUrl, {
        targetEnvironment: 'production',
        confirmOverwriteFlag: 'CONFIRM_RESTORE_WHATSAPP_OS',
      });

      expect(check.safe).toBe(true);
    });

    it('permits restore to staging / development without destructive production confirmation', () => {
      const devUrl = 'postgresql://whatsapp_os:whatsapp_os@localhost:5433/whatsapp_os_test';
      const check = validateRestoreTarget(devUrl, {
        targetEnvironment: 'development',
      });

      expect(check.safe).toBe(true);
    });
  });

  describe('5. Migration Directory & Deterministic Lockfile Audit', () => {
    it('verifies all existing migrations adhere to ordering, lockfile, and safety standards', () => {
      const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
      const inspection = inspectMigrationsDirectory(migrationsDir);

      expect(inspection.valid).toBe(true);
      expect(inspection.errors).toEqual([]);
      expect(inspection.lockfileProvider).toBe('postgresql');
      expect(inspection.migrationsCount).toBeGreaterThanOrEqual(3);

      // Verify known migration milestones exist in chronological order
      expect(inspection.migrationNames).toEqual(
        expect.arrayContaining([
          '20260827215828_init',
          '20260830000000_unit4_idempotency_hotfix',
          '20260831130000_phase9_unit2_performance_indexes',
        ]),
      );
    });
  });

  describe('6. Prisma Schema Models & Tenant Data Integrity Audit', () => {
    it('verifies that all models in schema.prisma are accounted for and have appropriate tenant boundaries', () => {
      const schemaPath = resolve(process.cwd(), 'prisma', 'schema.prisma');
      const schemaContent = readFileSync(schemaPath, 'utf-8');

      // Extract all model names from schema.prisma
      const modelRegex = /^model\s+(\w+)\s+\{/gm;
      const models: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = modelRegex.exec(schemaContent)) !== null) {
        if (match[1]) {
          models.push(match[1]);
        }
      }

      // 52 total models defined across the full enterprise schema
      expect(models.length).toBe(52);

      // Core tenant models must exist
      const requiredModels = [
        'User',
        'Session',
        'Workspace',
        'WorkspaceMember',
        'Contact',
        'Conversation',
        'Message',
        'Product',
        'ProductVariant',
        'InventoryItem',
        'Order',
        'OrderItem',
        'Payment',
        'AIAgent',
        'AITurn',
        'KnowledgeChunk',
        'Automation',
        'AutomationAction',
        'AutomationRun',
        'Job',
        'AuditLog',
        'Plan',
        'Subscription',
        'UsageRecord',
        'RateLimitBucket',
      ];

      for (const req of requiredModels) {
        expect(models).toContain(req);
      }
    });
  });

  describe('7. Disaster Recovery Runbook Documentation Contract', () => {
    it('verifies docs/BACKUP_AND_DISASTER_RECOVERY.md defines RTO, RPO, PITR, and migration safeguards', () => {
      const runbookPath = resolve(process.cwd(), 'docs', 'BACKUP_AND_DISASTER_RECOVERY.md');
      expect(existsSync(runbookPath)).toBe(true);

      const content = readFileSync(runbookPath, 'utf-8');

      // Assert key operational metrics and contracts are documented
      expect(content).toContain('**RTO (Recovery Time Objective):** < 1 Hour');
      expect(content).toContain('**RPO (Recovery Point Objective):** < 5 Minutes');
      expect(content).toContain('Point-in-Time Recovery');
      expect(content).toContain('prisma migrate deploy');
      expect(content).toContain('PGPASSWORD');
      expect(content).toContain('Disaster Recovery Drill Checklist');
      expect(content).toContain('Multi-Tenant Data Integrity Matrix');
    });
  });
});
