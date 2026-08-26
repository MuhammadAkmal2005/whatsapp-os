# Environment variables

Every variable is read in exactly one place: `config/env.ts`. That file parses `process.env` against a Zod
schema once, at import time, and throws if anything is missing or malformed. A misconfigured deployment fails at
boot with a list of problems rather than at the first request that happens to need the value.

`config/env.ts` starts with `import 'server-only'`, which makes it a build error for a client component to
import it. That is the mechanism keeping secrets out of the browser bundle — not a convention, a compile
failure. Two consequences follow, and both are rules:

**No other module reads `process.env`.** Grep for it: `config/env.ts` is the only hit outside `tests/` and
`tools/`. `config/features.ts` used to be a second reader and no longer is — it was the one exception, and it was
also a bug.

**A secret never goes in a `NEXT_PUBLIC_` variable.** Anything so prefixed is inlined into JavaScript served to
the browser. `NEXT_PUBLIC_APP_NAME` is the only one here, and it is a display string.

Copy `.env.example` to `.env` to start. `.env` is gitignored and must stay that way.

---

## Required

These two have no default. Nothing boots without them.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Needs the pgvector extension available for knowledge retrieval. |
| `AUTH_SECRET` | 32 characters minimum, enforced. Keys the encryption of stored provider tokens. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. |

Rotating `AUTH_SECRET` invalidates anything encrypted under the old value — stored WhatsApp and payment
credentials will need re-entering. Sessions survive, because session tokens are random rather than signed.

---

## Core

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. Several safety rules key off `production`. |
| `APP_URL` | `http://localhost:3000` | Must be a valid URL. Absolute links, webhook callback URLs, cookie scoping. |
| `NEXT_PUBLIC_APP_NAME` | `WhatsApp OS` | Display name. The codebase is not coupled to it. |
| `TEST_DATABASE_URL` | — | When set, the integration suite runs here and resets it freely. Point it at the 5433 container from `docker-compose.yml`, never at your development database. |

---

## AI

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | `openai` \| `mock`. The mock is deterministic and offline. |
| `AI_API_KEY` | — | Required when `AI_PROVIDER=openai`. |
| `AI_BASE_URL` | — | Optional. Any OpenAI-compatible gateway. |
| `AI_MODEL` | `gpt-4o-mini` | Customer-facing generation. |
| `AI_MODEL_FAST` | `gpt-4o-mini` | Classification and summarisation. Route cheap work here. |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Changing this invalidates existing embeddings; they must be regenerated before retrieval is trustworthy. |
| `AI_MAX_OUTPUT_TOKENS` | `600` | 64–4096. A hard ceiling per reply, for cost. |
| `AI_CONTEXT_MESSAGE_WINDOW` | `12` | 2–60 recent messages sent alongside the rolling summary. Never the full history. |
| `AI_RETRIEVAL_MIN_SCORE` | `0.35` | 0–1. Below this a knowledge chunk is not considered relevant, retrieval returns nothing, and the agent says it does not know rather than answering from a bad match. Lowering it trades honesty for coverage. |

Model prices live in `config/models.ts`, not here, so a price change is a reviewed code change rather than an
environment edit that silently alters every cost figure in the product.

---

## WhatsApp

| Variable | Default | Notes |
| --- | --- | --- |
| `MOCK_WHATSAPP` | `true` | When true no real message is ever sent. Outbound sends are recorded and an inbound simulator is exposed. |
| `WHATSAPP_API_VERSION` | `v21.0` | Graph API version. Pinned deliberately. |
| `WHATSAPP_ACCESS_TOKEN` | — | Required when `MOCK_WHATSAPP=false`. |
| `WHATSAPP_PHONE_NUMBER_ID` | — | Required when `MOCK_WHATSAPP=false`. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | — | Required when `MOCK_WHATSAPP=false`. |
| `WHATSAPP_VERIFY_TOKEN` | — | A string you choose. Meta echoes it during webhook verification; compared in constant time. Required when `MOCK_WHATSAPP=false`. |
| `META_APP_SECRET` | — | Verifies the `X-Hub-Signature-256` HMAC over the raw webhook body. Required when `MOCK_WHATSAPP=false`. |

**`config/env.ts` refuses to boot with `NODE_ENV=production` and `MOCK_WHATSAPP=true`.** The dangerous failure
is a live deployment answering real customers from a mock and nobody noticing, so it is made impossible rather
than documented as a caution.

Setting `MOCK_WHATSAPP=false` demands all five credentials at once. Half-connected is worse than disconnected:
messages would send while webhooks failed signature verification, so the business would talk to customers and
never hear the replies.

---

## Background jobs

| Variable | Default | Notes |
| --- | --- | --- |
| `QUEUE_DRIVER` | `postgres` | `postgres` \| `redis`. The Postgres driver uses `FOR UPDATE SKIP LOCKED` and needs no broker. |
| `REDIS_URL` | — | Required when `QUEUE_DRIVER=redis`. |

Redis is not a dependency for the MVP. The Postgres driver is one fewer service to run, back up and monitor, and
at MVP volumes the throughput difference does not matter.

---

## Storage

| Variable | Default | Notes |
| --- | --- | --- |
| `STORAGE_PROVIDER` | `local` | `local` \| `s3`. |
| `STORAGE_ENDPOINT` | — | Required when `s3`. Any S3-compatible endpoint. |
| `STORAGE_REGION` | `auto` | |
| `STORAGE_ACCESS_KEY` | — | Required when `s3`. |
| `STORAGE_SECRET_KEY` | — | Required when `s3`. |
| `STORAGE_BUCKET` | `whatsapp-os` | |
| `STORAGE_LOCAL_DIR` | `.storage` | Used when `local`. Gitignored. |
| `STORAGE_SIGNED_URL_TTL` | `900` | Seconds, 60–86400. Lifetime of signed URLs handed to the browser. |
| `STORAGE_MAX_UPLOAD_BYTES` | `20971520` | 20 MB. Minimum 1024. |

**`config/env.ts` refuses to boot with `NODE_ENV=production` and `STORAGE_PROVIDER=local`.** Serverless hosts
have ephemeral disks; uploads would vanish between deployments and the failure would look like data corruption.

Customer media is private. Files are served through signed, expiring URLs, never from a public bucket.

---

## Email

| Variable | Default | Notes |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `console` | `console` \| `smtp`. The console driver prints the message instead of sending it. |
| `EMAIL_FROM` | `WhatsApp OS <no-reply@example.com>` | |
| `SMTP_HOST` | — | Required when `smtp`. |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` | — | |
| `SMTP_PASSWORD` | — | |

With the console driver, team invitation emails are printed to the server log. That is where to find the invite
link in local development.

---

## Payments

| Variable | Default | Notes |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | `mock` | `mock` \| `stripe`. |
| `PAYMENT_SECRET` | — | Required when `stripe`. |
| `PAYMENT_WEBHOOK_SECRET` | — | Verifies payment webhook signatures. |
| `PAYMENT_PUBLIC_KEY` | — | Safe to expose; still read server-side and passed down deliberately. |

No card data is ever stored, in any provider mode.

---

## Billing and plans

| Variable | Default | Notes |
| --- | --- | --- |
| `TRIAL_DAYS` | `14` | 0–365. Configurable on purpose. |
| `DEFAULT_PLAN` | `free` | A plan key from `config/plans.ts`. |

Plan limits and prices live in `config/plans.ts`. Nothing is hard-coded at a call site, so a plan change is one
edit rather than a search across the codebase.

---

## Feature flags

| Variable | Default |
| --- | --- |
| `ENABLE_CAMPAIGNS` | `false` |
| `ENABLE_APPOINTMENTS` | `false` |
| `ENABLE_PAYMENTS` | `false` |
| `ENABLE_VOICE` | `false` |
| `ENABLE_ADVANCED_AI` | `false` |
| `ENABLE_PLATFORM_ADMIN` | `true` |

A disabled feature is absent from the UI entirely. It is never rendered as "coming soon" — a shop owner clicking
a dead control learns the product is unfinished, which is worse than not seeing it at all.

These are validated by `config/env.ts` like everything else, so an unrecognised value — `ENABLE_CAMPAIGNS=ture` —
refuses to boot and names the variable, rather than being read as "off".

Flags resolve **on the server only**. `config/features.ts` imports `server-only` and reads them through
`config/env.ts`; a server component calls `resolveFeatures(planKey)` and passes the resulting object to client
components as props. They are deliberately not `NEXT_PUBLIC_*`: those are inlined at build time, so one build
could not serve two deployments with different flags, and the whole flag set would ship in a bundle any visitor
can read. Flags are deployment configuration, not public data.

---

## Security

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_DURATION_DAYS` | `30` | 1–365. Sessions slide forward on use once past a fraction of their remaining life. |
| `PASSWORD_SCRYPT_COST` | `65536` | scrypt `N`. 2^16 with `r=8` costs roughly 64 MB and ~100 ms per hash. |
| `PASSWORD_SCRYPT_BLOCK_SIZE` | `8` | scrypt `r`. |
| `PASSWORD_SCRYPT_PARALLELISM` | `1` | scrypt `p`. |
| `RATE_LIMIT_ENABLED` | `true` | Set false only if rate limiting is terminated at the edge. |

Raise `PASSWORD_SCRYPT_COST` as hardware improves. Existing hashes carry their own parameters and keep
verifying, so raising it is safe and takes effect for new and changed passwords.

---

## Observability

| Variable | Default | Notes |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_FORMAT` | `pretty` | `pretty` \| `json`. Use `json` in production so a log aggregator can parse it. |

---

## Cross-field rules

`config/env.ts` enforces these in a `superRefine`, because each is a way a deployment can be half-configured
that no single field's type can catch.

- `AI_PROVIDER=openai` requires `AI_API_KEY`.
- `NODE_ENV=production` forbids `MOCK_WHATSAPP=true`.
- `MOCK_WHATSAPP=false` requires all five WhatsApp credentials.
- `QUEUE_DRIVER=redis` requires `REDIS_URL`.
- `STORAGE_PROVIDER=s3` requires endpoint, access key and secret key.
- `EMAIL_PROVIDER=smtp` requires `SMTP_HOST`.
- `PAYMENT_PROVIDER=stripe` requires `PAYMENT_SECRET`.
- `NODE_ENV=production` forbids `STORAGE_PROVIDER=local`.

When adding a variable, add it to the schema in `config/env.ts`, to `.env.example` with a comment explaining
what it does, and to this document. A variable that exists in only one of the three is a variable someone will
deploy without.
