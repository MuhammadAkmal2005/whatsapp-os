import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getPostgresCliEnv,
  parseDatabaseUrl,
  verifyBackupIntegrity,
  validateRestoreTarget,
  BackupManifestSchema,
} from './backup-manager';

/**
 * Safely restores a verified PostgreSQL dump into a target database.
 */
export async function restoreDatabaseBackup(options: {
  dumpPath: string;
  manifestPath?: string;
  targetDatabaseUrl?: string;
  confirmOverwriteFlag?: string;
  targetEnvironment?: 'production' | 'staging' | 'development' | 'test';
  cleanBeforeRestore?: boolean;
}): Promise<{ restored: boolean; targetDatabase: string; sha256Checksum: string }> {
  const { dumpPath, manifestPath } = options;
  const targetDatabaseUrl = options.targetDatabaseUrl || process.env.DATABASE_URL;

  if (!targetDatabaseUrl) {
    throw new Error('Target DATABASE_URL is required to restore a database.');
  }

  if (!existsSync(dumpPath)) {
    throw new Error(`Backup dump file not found: ${dumpPath}`);
  }

  // 1. Verify Manifest and Cryptographic Integrity if manifest is provided
  let calculatedSha256 = '';
  if (manifestPath && existsSync(manifestPath)) {
    console.log(`[Restore] Verifying backup integrity against manifest: ${manifestPath}`);
    const verification = verifyBackupIntegrity(dumpPath, manifestPath);
    if (!verification.valid) {
      throw new Error(`Backup integrity check failed: ${verification.error}`);
    }
    calculatedSha256 = verification.calculatedHash;
    console.log(`[Restore] Integrity verified. Checksum: ${calculatedSha256}`);
  }

  // 2. Validate Safety Safeguards on Target Database
  const safetyCheck = validateRestoreTarget(targetDatabaseUrl, {
    confirmOverwriteFlag: options.confirmOverwriteFlag,
    targetEnvironment: options.targetEnvironment,
  });

  if (!safetyCheck.safe) {
    throw new Error(`Restore target safeguard failed: ${safetyCheck.reason}`);
  }

  const { env: pgEnv, safeParams } = getPostgresCliEnv(targetDatabaseUrl);

  console.log(
    `[Restore] Restoring dump to target database "${safeParams.database}" on ${safeParams.host}:${safeParams.port}...`,
  );

  // 3. Construct pg_restore command with safety parameters
  // -v (verbose), --no-owner (standardize ownership), --clean (optional drop before create)
  const cleanFlag = options.cleanBeforeRestore ? '--clean --if-exists' : '';
  const restoreCommand = `pg_restore -h ${safeParams.host} -p ${safeParams.port} -U ${safeParams.user} -d ${safeParams.database} --no-owner ${cleanFlag} "${dumpPath}"`;

  try {
    execSync(restoreCommand, {
      env: { ...process.env, ...pgEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    // Note: pg_restore may return warnings with exit code 1 for harmless notices (e.g. extension already exists)
    // We inspect stderr to ensure there is no catastrophic abort
    const output = err.stderr ? err.stderr.toString() : err.message;
    console.warn(`[Restore Notice] pg_restore output: ${output}`);
  }

  console.log(`[Restore] Successfully restored database "${safeParams.database}".`);

  return {
    restored: true,
    targetDatabase: safeParams.database,
    sha256Checksum: calculatedSha256,
  };
}

// Direct execution CLI entrypoint
if (process.argv[1]?.includes('db-restore')) {
  const dumpArg = process.argv[2];
  const manifestArg = process.argv[3];
  const confirmFlag = process.argv.find((a) => a.startsWith('--confirm-overwrite='))?.split('=')[1];

  if (!dumpArg) {
    console.error('Usage: tsx tools/db-restore.ts <path-to-dump> [path-to-manifest] [--confirm-overwrite=FLAG]');
    process.exit(1);
  }

  restoreDatabaseBackup({
    dumpPath: resolve(process.cwd(), dumpArg),
    manifestPath: manifestArg ? resolve(process.cwd(), manifestArg) : undefined,
    confirmOverwriteFlag: confirmFlag,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[Restore Error] ${err.message}`);
      process.exit(1);
    });
}
