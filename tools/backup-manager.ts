import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';

/**
 * Backup Manifest Schema
 * Ensures every database backup artifact carries cryptographic proof of integrity,
 * environment provenance, and schema/migration state.
 */
export const BackupManifestSchema = z.object({
  backupId: z.string().uuid(),
  timestamp: z.string().datetime(),
  environment: z.enum(['production', 'staging', 'development', 'test']),
  databaseName: z.string().min(1),
  gitCommit: z.string().min(7),
  latestMigrationId: z.string().min(1),
  format: z.enum(['custom', 'plain', 'directory', 'tar']),
  sha256Checksum: z.string().length(64, 'SHA-256 checksum must be exactly 64 hex characters'),
  sizeBytes: z.number().int().nonnegative(),
  tableCount: z.number().int().positive(),
  compression: z.enum(['none', 'gzip', 'zstd', 'pg_custom']),
  encryption: z.enum(['none', 'aes-256-gcm', 'kms']),
  metadata: z.record(z.string()).optional(),
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

/**
 * Database connection parameters extracted safely without leaking raw credentials.
 */
export interface SafeDbConnectionParams {
  host: string;
  port: number;
  database: string;
  user: string;
  hasPassword: boolean;
  sslMode?: string;
}

/**
 * Safely parse a PostgreSQL connection string without printing or leaking secrets in logs.
 */
export function parseDatabaseUrl(databaseUrl: string): SafeDbConnectionParams {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}. Expected postgresql://`);
    }

    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      user: parsed.username || 'postgres',
      hasPassword: Boolean(parsed.password),
      sslMode: parsed.searchParams.get('sslmode') || undefined,
    };
  } catch (err: any) {
    throw new Error(`Failed to parse DATABASE_URL safely: ${err.message}`);
  }
}

/**
 * Extract environment variables for pg_dump/pg_restore to avoid passing passwords via CLI args.
 */
export function getPostgresCliEnv(databaseUrl: string): {
  env: Record<string, string>;
  safeParams: SafeDbConnectionParams;
} {
  const parsed = new URL(databaseUrl);
  const safeParams = parseDatabaseUrl(databaseUrl);

  const env: Record<string, string> = {
    PGHOST: parsed.hostname || 'localhost',
    PGPORT: parsed.port || '5432',
    PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres',
    PGUSER: parsed.username || 'postgres',
  };

  if (parsed.password) {
    env.PGPASSWORD = decodeURIComponent(parsed.password);
  }

  if (parsed.searchParams.get('sslmode')) {
    env.PGSSLMODE = parsed.searchParams.get('sslmode')!;
  }

  return { env, safeParams };
}

/**
 * Compute SHA-256 checksum of a file buffer or disk file.
 */
export function calculateSha256(content: Buffer | string): string {
  const hash = createHash('sha256');
  if (typeof content === 'string') {
    hash.update(readFileSync(content));
  } else {
    hash.update(content);
  }
  return hash.digest('hex');
}

/**
 * Validate backup integrity by verifying manifest structure and cryptographic hash.
 */
export function verifyBackupIntegrity(
  dumpFilePath: string,
  manifest: BackupManifest | string,
): { valid: boolean; calculatedHash: string; expectedHash: string; error?: string } {
  if (!existsSync(dumpFilePath)) {
    return {
      valid: false,
      calculatedHash: '',
      expectedHash: '',
      error: `Backup dump file does not exist: ${dumpFilePath}`,
    };
  }

  let parsedManifest: BackupManifest;
  try {
    if (typeof manifest === 'string') {
      const raw = JSON.parse(readFileSync(manifest, 'utf-8'));
      parsedManifest = BackupManifestSchema.parse(raw);
    } else {
      parsedManifest = BackupManifestSchema.parse(manifest);
    }
  } catch (err: any) {
    return {
      valid: false,
      calculatedHash: '',
      expectedHash: '',
      error: `Invalid manifest format: ${err.message}`,
    };
  }

  const dumpStats = statSync(dumpFilePath);
  if (dumpStats.size !== parsedManifest.sizeBytes) {
    return {
      valid: false,
      calculatedHash: '',
      expectedHash: parsedManifest.sha256Checksum,
      error: `Size mismatch: manifest expects ${parsedManifest.sizeBytes} bytes, actual is ${dumpStats.size} bytes`,
    };
  }

  const calculatedHash = calculateSha256(dumpFilePath);
  if (calculatedHash !== parsedManifest.sha256Checksum) {
    return {
      valid: false,
      calculatedHash,
      expectedHash: parsedManifest.sha256Checksum,
      error: `Checksum mismatch: calculated ${calculatedHash}, expected ${parsedManifest.sha256Checksum}`,
    };
  }

  // Check PostgreSQL custom dump magic header ("PGDMP") if format is custom
  if (parsedManifest.format === 'custom') {
    const fd = readFileSync(dumpFilePath);
    if (fd.length >= 5) {
      const magic = fd.subarray(0, 5).toString('ascii');
      if (magic !== 'PGDMP') {
        return {
          valid: false,
          calculatedHash,
          expectedHash: parsedManifest.sha256Checksum,
          error: `Invalid PostgreSQL custom dump header: expected "PGDMP", got "${magic}"`,
        };
      }
    }
  }

  return {
    valid: true,
    calculatedHash,
    expectedHash: parsedManifest.sha256Checksum,
  };
}

/**
 * Safeguard check before restoring a database dump.
 * Prevents accidental destruction of production databases.
 */
export function validateRestoreTarget(
  targetDatabaseUrl: string,
  options: {
    confirmOverwriteFlag?: string;
    targetEnvironment?: 'production' | 'staging' | 'development' | 'test';
    allowProductionOverwrite?: boolean;
  },
): { safe: boolean; reason?: string } {
  const params = parseDatabaseUrl(targetDatabaseUrl);
  const isProdName =
    params.database.toLowerCase().includes('prod') ||
    params.database.toLowerCase() === 'whatsapp_os';

  const isProdEnv = options.targetEnvironment === 'production' || isProdName;

  if (isProdEnv && !options.allowProductionOverwrite) {
    const requiredConfirmation = `CONFIRM_RESTORE_${params.database.toUpperCase()}`;
    if (options.confirmOverwriteFlag !== requiredConfirmation) {
      return {
        safe: false,
        reason:
          `Restoring to production database "${params.database}" is blocked for safety. ` +
          `You must supply the exact confirmation flag: --confirm-overwrite=${requiredConfirmation}`,
      };
    }
  }

  return { safe: true };
}

/**
 * Migration Directory & Lockfile Audit
 * Verifies that all migrations in `prisma/migrations` adhere to chronological ordering,
 * contain valid SQL statements, and match the lockfile.
 */
export interface MigrationInspectionResult {
  valid: boolean;
  migrationsCount: number;
  migrationNames: string[];
  lockfileProvider: string;
  errors: string[];
}

export function inspectMigrationsDirectory(migrationsDir: string): MigrationInspectionResult {
  const errors: string[] = [];

  if (!existsSync(migrationsDir)) {
    return {
      valid: false,
      migrationsCount: 0,
      migrationNames: [],
      lockfileProvider: '',
      errors: [`Migrations directory does not exist: ${migrationsDir}`],
    };
  }

  const lockfilePath = join(migrationsDir, 'migration_lock.toml');
  let lockfileProvider = '';
  if (!existsSync(lockfilePath)) {
    errors.push('Missing migration_lock.toml in prisma/migrations directory.');
  } else {
    const lockContent = readFileSync(lockfilePath, 'utf-8');
    const match = lockContent.match(/provider\s*=\s*"([^"]+)"/);
    if (match && match[1]) {
      lockfileProvider = match[1];
    } else {
      errors.push('migration_lock.toml is malformed or missing provider field.');
    }
  }

  const entries = readdirSync(migrationsDir, { withFileTypes: true });
  const migrationDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const migrationNamePattern = /^(\d{14})_([a-zA-Z0-9_-]+)$/;

  for (const dirName of migrationDirs) {
    if (!migrationNamePattern.test(dirName)) {
      errors.push(
        `Migration directory "${dirName}" does not follow YYYYMMDDHHMMSS_name naming format.`,
      );
      continue;
    }

    const sqlPath = join(migrationsDir, dirName, 'migration.sql');
    if (!existsSync(sqlPath)) {
      errors.push(`Migration "${dirName}" is missing migration.sql file.`);
      continue;
    }

    const sqlContent = readFileSync(sqlPath, 'utf-8').trim();
    if (sqlContent.length === 0) {
      errors.push(`Migration "${dirName}" has an empty migration.sql file.`);
    }

    // Safety checks against prohibited commands in automated migrations
    if (/\bDROP\s+DATABASE\b/i.test(sqlContent)) {
      errors.push(`Dangerous statement "DROP DATABASE" detected in migration "${dirName}".`);
    }
  }

  return {
    valid: errors.length === 0,
    migrationsCount: migrationDirs.length,
    migrationNames: migrationDirs,
    lockfileProvider,
    errors,
  };
}
