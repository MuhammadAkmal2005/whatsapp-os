# Deployment

Nothing here has been deployed yet. This is the intended target and the checklist that has to pass before it is,
written so the first deployment is a procedure rather than an improvisation.

---

## Shape

Four pieces, three of them managed:

**Application** — Next.js, on Vercel or any Node host. Serverless is fine for the app itself.

**PostgreSQL 14+ with pgvector** — managed. Neon, Supabase and RDS all work; the requirement is that `CREATE
EXTENSION vector` and `pg_trgm` are permitted, which not every managed provider allows. Check this before choosing,
because knowledge retrieval does not work without it and migrating databases later is a bad week.

**Object storage** — S3-compatible. R2, S3, or Spaces. Private buckets only.

**A worker process** — `npm run worker`, running continuously. This is the one piece that cannot be serverless.

### The worker needs somewhere that is not serverless

Background jobs — document ingestion, embeddings, scheduled follow-ups, campaign sends, reminders, webhook
retries, analytics aggregation — run in a long-lived process that polls the queue. A serverless function times out
and cannot hold a `FOR UPDATE SKIP LOCKED` claim across its own lifetime.

So the worker goes on a small always-on host: Railway, Fly, Render, an EC2 instance, a container. One instance is
enough to start, and the queue driver competes correctly between several when it is not, because the claim is a
row lock rather than an in-process assumption.

Deploying the app without the worker produces a system that looks healthy and quietly does nothing asynchronous.
Uploaded documents sit at `PENDING` forever and no follow-up is ever sent. **Both processes must ship together,
from the same commit** — a worker running old handler code against a new schema is a subtler version of the same
failure.

### Redis is optional

`QUEUE_DRIVER=postgres` is the default and uses `FOR UPDATE SKIP LOCKED`, which needs no broker. That is one fewer
service to run, back up, monitor and pay for, and at MVP volumes the throughput difference is irrelevant. Move to
`redis` when queue depth actually justifies it, not before.

---

## Environment

Every variable is documented in `docs/ENVIRONMENT.md`. Only `DATABASE_URL` and `AUTH_SECRET` have no default.

Generate the secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Set it in the host's secret store. Never in a file, never in the repository, never in a build log.

**Rotating `AUTH_SECRET` invalidates everything encrypted under it** — stored WhatsApp access tokens and payment
credentials will need re-entering. Sessions survive, because session tokens are random rather than signed. Rotation
is therefore a planned operation with a re-connect step, not a routine hygiene task.

### Production refuses to boot when misconfigured

`config/env.ts` parses the environment once at import time and throws on anything missing or contradictory, so a
misconfigured deployment fails at boot with a list of problems rather than at the first request that happens to
need a value. Two rules are specifically about production:

**`NODE_ENV=production` with `MOCK_WHATSAPP=true` is refused.** The dangerous failure is a live deployment
answering real customers from a mock while everyone believes it is connected.

**`NODE_ENV=production` with `STORAGE_PROVIDER=local` is refused.** Serverless hosts have ephemeral disks; uploads
would vanish between deployments and the failure would look like data corruption to the business whose customer
sent a payment screenshot.

Both are enforced rather than documented as cautions, because a caution in a document is not a control.

Production also wants `LOG_FORMAT=json` so an aggregator can parse the output, and `LOG_LEVEL=info`.

---

## Database

```bash
npm run db:deploy      # apply pending migrations — this is the production command
```

`db:deploy` runs `prisma migrate deploy`, which applies existing migrations and creates nothing new.
**`db:migrate` and `db:push` must never run against production**: the first can generate a migration from a schema
drift, and the second alters the database to match the schema with no migration history and no review. `db:reset`
destroys data and exists for development.

**Migrations are forward-only in production.** To undo a deployed migration, write a new one that reverses it.

**Additive migrations are safe; destructive ones need two deployments.** Dropping a column that running code still
reads takes the application down for the interval between deploy and rollout. Ship the code that stops reading it,
then drop the column in a later migration. The same applies to renames, which Prisma may implement as a drop and
an add — read the generated SQL.

The initial migration has not been generated yet. When it is, verify it creates the `vector` and `pg_trgm`
extensions, and add the HNSW index on `knowledge_chunks.embedding`; without that index, retrieval degrades to a
sequential scan over every chunk.

Connection pooling matters on serverless. Each function instance opens its own connection and a managed Postgres
will refuse new ones long before traffic feels heavy, so use the provider's pooler — PgBouncer in transaction mode,
Neon's pooled endpoint, Supabase's pooler port — and point `DATABASE_URL` at it.

---

## Order of operations

The sequence matters more than any individual step.

1. Provision the database and enable `vector` and `pg_trgm`.
2. Provision object storage, private, with credentials scoped to that one bucket.
3. Set every environment variable on both the app and the worker.
4. Run `npm run db:deploy`.
5. Deploy the application.
6. Deploy the worker from the same commit.
7. Configure the Meta webhook to `https://your-domain/api/webhooks/whatsapp` with the verify token, and complete
   the handshake.
8. Set `MOCK_WHATSAPP=false` with all five WhatsApp credentials present.
9. Send one real message end to end before telling anyone it is live.

Migrations run before the deploy, not after, because the new code expects the new schema. This is also why
destructive changes take two deployments: there is no ordering that makes "drop a column the running code reads"
safe in one.

Step 8 is all-or-nothing by design — `config/env.ts` demands all five credentials together. Half-connected is worse
than disconnected: messages would send while webhooks failed signature verification, so the business would talk to
customers and never hear the replies.

---

## Verifying a deployment

`npm run verify` — lint, typecheck, test, build — must pass before deploying. It has never been run in the
authoring environment, which had no package registry; see `docs/TESTING.md` for exactly what has and has not been
executed.

After deploying, check in this order, because each answers a question the next one depends on:

Does the app boot? A configuration error surfaces immediately and names the variable.

Can it reach the database? Sign in.

Is the worker running and claiming jobs? Upload a document and watch `IngestStatus` move `PENDING → PROCESSING →
READY`. If it stays `PENDING`, the worker is not running — this is the most likely first-deployment fault and the
easiest to miss, because nothing errors.

Does the webhook verify? Meta's handshake either succeeds or does not, visibly.

Does a real message arrive, appear in the inbox, and get answered? Then it is deployed.

---

## Rollback

Application rollback is a redeploy of the previous build, and it is safe **only if the schema is compatible** —
which is the argument for additive migrations restated as an operational property. A rollback across a destructive
migration does not work, and discovering that during an incident is the worst time to learn it.

Roll the worker back with the app, from the same commit.

If a migration is the problem, write a forward migration that fixes it. Do not hand-edit the database and do not
delete migration files; both leave the recorded history disagreeing with reality, and the next `migrate deploy`
will do something surprising.

---

## Backups

Managed Postgres with point-in-time recovery, and **a restore that has actually been tested**. An untested backup
is a belief, not a backup, and the moment it matters is the worst moment to find out.

This product holds other businesses' customer lists and order histories. Losing them is not an inconvenience we
recover from; it is the end of the product's reputation. Retention and restore procedure are a Phase 9 task and a
launch blocker, not a nice-to-have.

Object storage needs versioning enabled so a bad delete is recoverable.

---

## Before the first real customer

Not yet done, and each is a launch blocker rather than an improvement:

An error monitor and a log aggregator. `lib/logger.ts` is the structured-logging seam they attach to; there is no
`server/observability/` module yet, and the monitoring interface is still to be written. Uptime checks on the app,
the webhook endpoint and worker liveness — a silently dead worker is the failure mode most likely to go unnoticed,
because the product looks fine. Alerts on webhook failure rate, AI error rate and queue depth. A security contact
address and disclosure policy, which `docs/SECURITY.md` records as missing. A privacy policy, since this is
customer data belonging to third parties. Row-level security, planned for Phase 9, to make tenant isolation a
property of the database rather than only of the application. And CI running `npm run verify` on every pull
request against a Postgres service container.
