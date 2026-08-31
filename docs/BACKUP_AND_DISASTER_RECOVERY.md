# Database Backup, Disaster Recovery & Migration Runbook

> **Target Recovery Objectives:**
> - **RTO (Recovery Time Objective):** < 1 Hour (Complete restoration and validation of application state).
> - **RPO (Recovery Point Objective):** < 5 Minutes (Maximum allowable data loss window via continuous WAL archiving).

This runbook establishes the production operational protocols for database backup snapshots, point-in-time recovery (PITR), schema migration deployments, rollback safeguards, and disaster recovery drills for WhatsApp OS.

---

## 1. System Architecture & Responsibility Separation

PostgreSQL backup and disaster recovery operates across three distinct operational layers. A failure in one must not compromise the integrity of the others.

```
+-------------------------------------------------------------------------+
| Layer 1: Application & Tooling (Codebase Responsibility)                |
| - Pre-migration verified logical snapshots (pg_dump + SHA-256 Manifest)  |
| - Deterministic migration application (`prisma migrate deploy`)         |
| - Health probe verification (`/api/health/readiness`, `/api/metrics`)   |
| - Safety guardrails preventing unconfirmed production overwrites        |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Layer 2: Database Infrastructure (Managed Provider / Cloud Ops)         |
| - Continuous Write-Ahead Log (WAL) archiving                            |
| - Automated daily physical snapshots (storage volume level)             |
| - Point-in-Time Recovery (PITR) target resolution                       |
| - Multi-AZ replica failover (Primary -> Standby)                        |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Layer 3: Object Storage (Private Bucket S3 / R2 / GCS)                   |
| - Private encrypted storage for logical dump archives                   |
| - S3 Object Versioning enabled (protection against accidental deletion) |
| - 30-day lifecycle retention policy with immutable lock (WORM)          |
+-------------------------------------------------------------------------+
```

---

## 2. Backup Strategy & Procedures

### 2.1 Managed Cloud Database Backups (Primary Strategy)
When hosted on managed PostgreSQL (AWS RDS Aurora, Supabase Enterprise, Neon Pro):
1. **Continuous WAL Archiving**: Point-in-Time Recovery must be enabled with a minimum **7-day retention window** (recommended: 30 days).
2. **Automated Physical Snapshots**: Configured daily during off-peak hours (e.g. 02:00 UTC).
3. **Storage Encryption**: KMS-managed AES-256 volume encryption at rest.

### 2.2 Pre-Migration & On-Demand Logical Snapshots (Application Tooling)
Before deploying schema migrations or major infrastructure changes, operators must execute a verified logical backup using the provided tooling:

```bash
# Create a verified snapshot of the active database with SHA-256 manifest
npm run db:backup
# Or via CLI directly:
npx tsx tools/db-backup.ts
```

#### Manifest Provenance
Every snapshot automatically generates a companion cryptographic manifest (`.manifest.json`):
```json
{
  "backupId": "d7a48d82-8874-4b53-b3c4-4cbcf0984920",
  "timestamp": "2026-08-31T14:30:00.000Z",
  "environment": "production",
  "databaseName": "whatsapp_os",
  "gitCommit": "02567ba",
  "latestMigrationId": "20260831130000_phase9_unit2_performance_indexes",
  "format": "custom",
  "sha256Checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sizeBytes": 4829104,
  "tableCount": 52,
  "compression": "pg_custom",
  "encryption": "none"
}
```

### 2.3 Secret Hygiene
- Database passwords and tokens are **never** passed via CLI arguments (which would leak into `ps` process tables).
- The backup tooling injects credentials through scoped environment variables (`PGPASSWORD`, `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`) parsed securely via `parseDatabaseUrl()`.

---

## 3. Point-in-Time Recovery (PITR) Protocol

Point-in-Time Recovery allows restoring the database state to an exact millisecond timestamp (e.g., immediately before an errant batch query, corrupted migration, or severe security breach).

### 3.1 Managed Provider PITR Execution

#### AWS RDS / Aurora PostgreSQL
1. Open the Amazon RDS Console -> Select the `whatsapp-os-prod` database cluster.
2. Select **Actions** -> **Restore to point in time**.
3. Choose **Custom restore time** (e.g., `2026-08-31 14:12:00 UTC`).
4. Enter the new DB instance identifier: `whatsapp-os-prod-restored-pitr`.
5. Launch the instance in the production VPC.
6. Once the restored instance reaches `Available`, update the connection pooler / application `DATABASE_URL` during a brief maintenance window.

#### Supabase / Neon
1. In the Supabase/Neon project dashboard, navigate to **Backups** -> **Point in Time Recovery**.
2. Select the target timestamp and click **Restore to New Project** or **Clone Database at Timestamp**.
3. Validate data integrity on the restored branch before re-pointing DNS/connection string.

### 3.2 Self-Hosted WAL-G / pg_backrest PITR Protocol
If self-hosting PostgreSQL:
```bash
# 1. Stop PostgreSQL service
systemctl stop postgresql

# 2. Restore base backup to data directory
wal-g backup-fetch /var/lib/postgresql/16/main LATEST

# 3. Configure recovery target timestamp in postgresql.conf / recovery.signal
touch /var/lib/postgresql/16/main/recovery.signal
cat <<EOF >> /var/lib/postgresql/16/main/postgresql.conf
restore_command = 'wal-g wal-fetch "%f" "%p"'
recovery_target_time = '2026-08-31 14:12:00 UTC'
recovery_target_action = 'promote'
EOF

# 4. Start PostgreSQL and verify recovery log
systemctl start postgresql
```

---

## 4. Production Migration Deployment Protocol

All database migrations must strictly follow the **Forward-Only, Zero-Downtime** deployment sequence:

```
Step 1: Pre-Migration Snapshot (Logical Dump + SHA-256 Manifest)
        |
Step 2: Apply Migrations via `prisma migrate deploy` (`npm run db:deploy`)
        |
Step 3: Post-Migration Health & Readiness Verification (`/api/health/readiness`)
        |
Step 4: Application Server Deployment (New Code Rollout)
        |
Step 5: Background Worker Deployment (`npm run worker`)
```

### 4.1 Deployment Safety Rules
1. **Never use `prisma db push` or `prisma migrate dev` in production.** Only `npm run db:deploy` (`prisma migrate deploy`) is permitted.
2. **Never drop or rename active columns in a single step.** 
   - *Phase 1*: Deploy additive migration (add new nullable column).
   - *Phase 2*: Deploy application code writing to both / reading new column.
   - *Phase 3*: Backfill historical data.
   - *Phase 4*: Deploy final migration dropping old column.
3. **Lock Timeouts**: Complex index additions must use `CREATE INDEX CONCURRENTLY` or run with low `lock_timeout` to prevent blocking live customer transactions.

---

## 5. Rollback & Disaster Recovery Procedures

### 5.1 Rollback Decision Tree

```
                               Migration Failure / Issue Detected
                                                |
                      +-------------------------+-------------------------+
                      |                                                   |
           Data Intact / Schema Error                             Data Corrupted / Loss
                      |                                                   |
                      v                                                   v
         [Scenario A: Forward Fix]                              [Scenario B: PITR Restore]
         Write & apply reversing                              Execute PITR to timestamp
         migration via `db:deploy`                             immediately preceding incident
```

### 5.2 Safe Restoration via Application Tooling
To restore a snapshot dump to a staging, recovery, or disaster recovery instance:

```bash
# Verify integrity and restore to recovery database
npx tsx tools/db-restore.ts .backups/backup_whatsapp_os_2026-08-31.dump .backups/backup_whatsapp_os_2026-08-31.manifest.json

# If restoring to a production database, the safety guard requires explicit confirmation:
npx tsx tools/db-restore.ts \
  .backups/backup_whatsapp_os_2026-08-31.dump \
  .backups/backup_whatsapp_os_2026-08-31.manifest.json \
  --confirm-overwrite=CONFIRM_RESTORE_WHATSAPP_OS
```

---

## 6. Multi-Tenant Data Integrity Matrix

Every backup and recovery procedure guarantees complete relational integrity across all **52 Prisma schema models**. No tenant-scoped data is isolated or partitioned into external non-relational stores.

| Domain | Key Models Protected | Integrity & Retention Requirements |
| :--- | :--- | :--- |
| **Auth & Identity** | `User`, `Session`, `VerificationToken`, `WorkspaceMember`, `WorkspaceInvite` | Passwords (scrypt), sessions, and RBAC memberships preserved. |
| **Tenant Boundaries** | `Workspace`, `WorkspaceDomain`, `AuditLog` | Tenant UUID references, settings, and compliance audit logs. |
| **CRM & Messaging** | `Contact`, `ContactTag`, `Conversation`, `Message`, `MessageAttachment` | Full conversational histories, participant links, and inbound messages. |
| **E-Commerce & Orders**| `Product`, `ProductVariant`, `InventoryItem`, `Order`, `OrderItem`, `Payment` | Minor-unit pricing (integer cents/paisa), immutable order snapshots, inventory levels. |
| **AI Agent & RAG** | `AIAgent`, `AITurn`, `KnowledgeChunk` (`vector(1536)`), `ToolDefinition` | Vector embeddings, prompt templates, and AI turn audit records. |
| **Automation** | `Automation`, `AutomationAction`, `AutomationRun`, `Job` | Active wait queues, trigger rules, and scheduled background tasks. |
| **Billing & Plans** | `Plan`, `Subscription`, `UsageRecord`, `RateLimitBucket` | Active subscriptions, quota limits, and metered usage aggregations. |

---

## 7. Operational Failure Modes & Mitigation Matrix

| Failure Mode | Impact | Classification | Action Required |
| :--- | :--- | :--- | :--- |
| **Database Connection Refused** | Full outage | `Manual Intervention` | Check database pooler status, verify network security groups, inspect managed DB cluster health. |
| **Backup Integrity Check Failed (SHA-256 mismatch)** | Restore aborted | `Safe / Retryable` | Discard corrupted dump archive; re-download from object storage or re-trigger snapshot. |
| **Migration Lock Timeout** | `migrate deploy` hangs | `Manual Intervention` | Inspect active locking queries in `pg_stat_activity`; terminate long-running transactions; retry migration. |
| **Accidental Production Overwrite Attempt** | Potential data loss | `Blocked by Tooling` | `validateRestoreTarget()` aborts operation unless exact `CONFIRM_RESTORE_<DB>` flag is explicitly passed. |
| **Object Storage S3 Outage** | Inability to upload/download backups | `Retryable` | Tooling retries with exponential backoff; local snapshots retained on disk until storage recovers. |
| **Worker Process Crash during Migration** | Jobs pause | `Safe / Self-Healing` | Unprocessed jobs remain in `Job` table (`FOR UPDATE SKIP LOCKED`); worker resumes processing on restart. |

---

## 8. Disaster Recovery Drill Checklist (Bi-Annual)

Execute this drill every 6 months to validate that the team and runbooks remain production-ready:

- [ ] **Step 1: Snapshot Creation**: Execute `npx tsx tools/db-backup.ts` on staging/demo database.
- [ ] **Step 2: Manifest & SHA-256 Validation**: Verify manifest checksum and headers using `tools/backup-manager.ts`.
- [ ] **Step 3: Ephemeral Restore**: Spin up an isolated PostgreSQL container or test database.
- [ ] **Step 4: Restoration Execution**: Execute `npx tsx tools/db-restore.ts` against the test target.
- [ ] **Step 5: Schema & Migration Audit**: Run `npm run typecheck` and execute integration suite against restored database.
- [ ] **Step 6: Tenant Isolation Test**: Verify Workspace A vs Workspace B cross-tenant boundary isolation.
- [ ] **Step 7: Sign-Off**: Record RTO time elapsed and log the recovery drill outcome in the internal audit register.
