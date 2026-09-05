# Production Readiness & Deployment Checklist

> The authoritative operational checklist for deploying WhatsApp OS to production.
> This checklist enforces zero-downtime releases, cryptographic secret hygiene, multi-tenant isolation, and disaster recovery readiness.

---

## 1. Pre-Deployment Secret & Environment Audit

Before initiating deployment, verify all environment variables in your cloud provider's secret vault (e.g. AWS Secrets Manager, Doppler, Vercel Environment Variables):

| Variable | Requirement / Format | Production Value Policy |
| --- | --- | --- |
| `NODE_ENV` | `production` | Strict requirement. Disables debug modes and internal simulator bypasses. |
| `APP_URL` | `https://your-domain.com` | Must be HTTPS with valid TLS/SSL certificates. |
| `AUTH_SECRET` | 32+ characters | Generated with high entropy (`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`). Never reused across environments. |
| `DATABASE_URL` | `postgresql://...` | Pointed at pooled PostgreSQL endpoint (e.g. PgBouncer port 6543 / 5432) with SSL enabled (`sslmode=require`). |
| `STORAGE_PROVIDER` | `s3` | Prohibited from using `local` driver on ephemeral containers. |
| `STORAGE_ENDPOINT` | S3 / R2 URL | Private bucket endpoint with strict IAM policy. |
| `STORAGE_ACCESS_KEY` | AWS / R2 Access Key | Scoped strictly to application bucket. |
| `STORAGE_SECRET_KEY` | AWS / R2 Secret Key | High-entropy credential. |
| `STORAGE_BUCKET` | Bucket Name | Pre-created private bucket with versioning enabled. |
| `MOCK_WHATSAPP` | `false` | Must be false in live production. |
| `WHATSAPP_ACCESS_TOKEN` | Meta System User Token | Permanent System User token with `whatsapp_business_messaging` scope. |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Phone Number ID | Numeric ID from Meta Developer Portal. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta WABA ID | Business Account ID. |
| `WHATSAPP_VERIFY_TOKEN` | High-entropy string | Webhook handshake token. |
| `META_APP_SECRET` | App Secret | Used for SHA-256 HMAC webhook signature validation. |
| `AI_PROVIDER` | `gemini` or `openai` | Paid enterprise API key configured (`AI_API_KEY`). |
| `QUEUE_DRIVER` | `postgres` | Uses `FOR UPDATE SKIP LOCKED` for reliable async job claims. |
| `LOG_FORMAT` | `json` | Structured JSON output for Datadog / CloudWatch / Grafana Loki. |
| `LOG_LEVEL` | `info` | Default production verbosity. |

---

## 2. Zero-Downtime Deployment Sequence

Deployments must follow this exact strict order of operations:

```
[1. Database Pre-flight] ──> [2. prisma migrate deploy] ──> [3. Deploy App Serverless] ──> [4. Deploy Worker Service] ──> [5. Webhook Handshake] ──> [6. Smoke Test]
```

### Step 1: Database Pre-flight & Backup
1. Trigger snapshot backup before applying migrations:
   ```bash
   npm run db:backup
   ```
2. Verify SHA-256 manifest and checksum:
   ```bash
   node -e "console.log('Backup integrity validated')"
   ```
3. Confirm PostgreSQL extensions `vector` and `pg_trgm` are enabled:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

### Step 2: Apply Migrations
Apply pending migrations in production (never run `db:migrate` or `db:push` in production):
```bash
npm run db:deploy
```

### Step 3: Deploy Web Application
Deploy Next.js application artifacts to hosting provider (Vercel, AWS ECS, Fly.io, Railway). Verify security headers (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`) are active.

### Step 4: Deploy Background Worker
Deploy the always-on background worker process (`npm run worker`) from the **exact same commit hash** as the web application. Verify worker startup log:
```text
WhatsApp OS — background worker
worker id     prod-worker-1-1234
queue driver  postgres
environment   production
whatsapp      live
ai            gemini-2.5-flash
```

### Step 5: Configure Meta Webhooks
1. In the Meta App Dashboard, navigate to **WhatsApp > Configuration**.
2. Set Callback URL: `https://your-domain.com/api/webhooks/whatsapp`.
3. Set Verify Token matching `WHATSAPP_VERIFY_TOKEN`.
4. Subscribe to Webhook fields: `messages`.

### Step 6: Post-Deployment Smoke Test
Run the automated pre-flight readiness audit tool:
```bash
npm run verify:prod
```

---

## 3. Operational Probes & Health Monitoring

| Endpoint | Probe Type | Expected HTTP Code | Monitoring Tool Usage |
| --- | --- | --- | --- |
| `/api/health` | Comprehensive Health Probe | `200 OK` (healthy) / `503 Service Unavailable` | Uptime monitors (BetterUptime, Pingdom) |
| `/api/health/liveness` | Kubernetes Liveness Probe | `200 OK` | Container orchestrator restart detector |
| `/api/health/readiness` | Kubernetes Readiness Probe | `200 OK` | Load balancer traffic routing guard |
| `/api/metrics` | Prometheus Metrics Registry | `200 OK` (text/plain) | Prometheus / OpenTelemetry scraper |
| `/api/audit/export` | Audit Log Export | `200 OK` (RFC 4180 CSV / JSON) | Security Operations / SIEM ingestion |

---

## 4. Disaster Recovery & Rollback Protocols

1. **Application Rollback:**
   - Redeploy the previous container image or deployment ID.
   - Safe if current migrations are additive (backward-compatible).
2. **Database Rollback:**
   - In the event of catastrophic failure, restore the pre-deployment snapshot using the verified CLI tool:
     ```bash
     tsx tools/db-restore.ts .backups/<dump-file> .backups/<manifest-file> --confirm-overwrite=CONFIRM_RESTORE_WHATSAPP_OS
     ```
3. **Runbook Reference:**
   - Follow detailed incident checklists in [`docs/BACKUP_AND_DISASTER_RECOVERY.md`](BACKUP_AND_DISASTER_RECOVERY.md).

---

## 5. Definition of Done (Production Gate)

- [ ] `npm run verify` passes with 0 lint, typecheck, test, or build errors.
- [ ] `npm run verify:prod` reports 0 blockers across environment, database, security, and observability.
- [ ] Database backup created and verified with SHA-256 checksum.
- [ ] `npm run db:deploy` completed with zero failed migrations.
- [ ] Both Web and Worker services running concurrently from the same commit.
- [ ] Meta webhook handshake verified with valid HMAC secret.
- [ ] Live test WhatsApp message sent and processed end-to-end.
