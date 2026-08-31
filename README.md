# WhatsApp OS

**Turn WhatsApp into your AI-powered business operating system.**

A multi-tenant SaaS that connects a small business's official WhatsApp Business number and runs their whole
customer operation behind it: an AI agent that answers from the business's real data, plus a CRM, product
catalogue, order book, automation engine, and analytics. The first market is Pakistan and the first vertical is
online clothing and e-commerce sellers.

The user is a shop owner, not an engineer. That constraint shapes most of the product decisions in here.

---

## Status

Under active development. Phases 0–9 and Phase 10 Units 1–2 are fully built, tested, and committed. Details in [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Planning, environment, Prisma schema (52 models), error/logging/config foundation, job queue | Built & Committed (`6b696e5`) |
| 1 | Authentication, workspaces, roles and permissions, team management, dashboard shell, marketing pages | Built & Committed (`462719a`) |
| 2 | Contacts, products with variants & inventory, orders with server-side totals, seed data | Built & Committed (`3833d7b`) |
| 3 | Conversation inbox (3-column responsive), messages backend, mock WhatsApp provider, e2e simulator | Built & Committed (`c341cb8`) |
| 4 | WhatsApp Cloud API integration (Meta provider, webhooks, processor, account UI, text acceptance) | Complete & Released (`a823b83`, `8b857df`, `75360a5`, `9f28ecb`, `96efc21`) |
| 5 | AI agent runtime, prompt assembly, Gemini provider, Knowledge Base RAG, tools, human handoff | Complete & Released (`69a615a`, `0e3a909`) |
| 6 | Automation engine, trigger matching, workflow builder, WAIT/resume, notifications, idle scanner | Complete & Released (`69b98d3`, `217d8ea`, `3408a8b`, `a2fe14c`) |
| 7 | Analytics aggregation, usage metering per workspace, AI cost tracking, dashboard charts | Complete & Released (`d535f40`, `9b73360`, `3587f7e`) |
| 8 | Billing, plans, subscriptions, quota limits, Stripe/mock checkout | Complete & Released (`ce77f59`, `91e06e2`, `441a033`) |
| 9 | Security hardening, CSP, RLS, performance indexes, observability, metrics & audit export | Complete & Released (`108584c`, `94a8a41`, `cf7d193`) |
| 10 | Production deployment, CI/CD automation, backup & disaster recovery | In Progress (Units 1 & 2 Complete) |

---

## Getting started

You need Node 20 or newer, npm, and PostgreSQL 14 or newer with the [pgvector](https://github.com/pgvector/pgvector)
extension available — knowledge retrieval stores embeddings in the same database. `docker-compose.yml` brings up
a `pgvector/pgvector:pg16` instance on port 5432, plus a second throwaway one on 5433 that the integration
suite can reset without destroying your development data.

```bash
git clone <this repository>
cd whatsapp-os
npm install

cp .env.example .env
docker compose up -d          # optional, if you are not running Postgres yourself

npm run db:migrate            # creates prisma/migrations on first run, then applies it
npm run dev                   # http://localhost:3000
```

**Only two variables have no default and must be filled in: `DATABASE_URL` and `AUTH_SECRET`.** Everything else
is either defaulted or genuinely optional, and `config/env.ts` validates the lot at boot — a half-configured
deployment fails immediately with a list of what is wrong rather than at the first request that needs the value.

`AUTH_SECRET` must be at least 32 characters. Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

You do not need an AI key, a WhatsApp connection, a payment processor, Redis or S3 to run the application.
`AI_PROVIDER` defaults to `mock`, `MOCK_WHATSAPP` to `true`, `QUEUE_DRIVER` to `postgres`, `STORAGE_PROVIDER` to
`local`, `EMAIL_PROVIDER` to `console`. Each of those is a real, labelled offline driver rather than a
pretend one, and the UI says when a mock is answering. `config/env.ts` refuses to boot in production with
`MOCK_WHATSAPP=true` or with the local disk storage driver, so the mocks cannot follow you into a live
deployment by accident.

---

## Commands

```bash
npm run dev            # development server
npm run build          # prisma generate && next build
npm run start          # serve the production build

npm run lint           # ESLint
npm run typecheck      # tsc --noEmit, strict
npm run test           # Vitest
npm run test:watch
npm run test:coverage
npm run test:e2e       # Playwright (config lands with Phase 3)
npm run verify         # lint + typecheck + test + build — the phase gate

npm run db:migrate     # apply migrations in development
npm run db:deploy      # apply migrations in production
npm run db:push        # sync schema without a migration (dev only)
npm run db:generate    # regenerate the Prisma client
npm run db:seed        # realistic seed data (arrives with Phase 2)
npm run db:reset       # drop, migrate, seed
npm run db:studio      # Prisma Studio

npm run worker         # background job worker
```

### Verifying without a package registry

Some of this was written in an environment with no npm access, so `tsc`, `next build` and Vitest could not run
there. Three dependency-free tools stand in, and they are useful anywhere as a fast pre-flight:

```bash
npm run syntax          # parses every .ts file with Node's type stripper (skips .tsx — no JSX parser)
npm run imports         # resolves every first-party import and checks each named binding is really exported
npm run test:sandbox    # runs the pure unit tests under a minimal Vitest shim
npm run verify:sandbox  # all three
```

These are a safety net, not a substitute. `npm run imports` is textual — it catches a moved constant or a
dropped re-export, which is what a refactor breaks, but it knows nothing about types. **`npm run verify` is the
real gate**, and a phase is not complete until it passes.

---

## How it fits together

```
route / server action  →  service  →  repository  →  Prisma
                       →  provider adapter  →  external API
```

Calls go one direction only. A route never touches Prisma; a repository never knows about HTTP; a provider
adapter never knows about our domain models. Business rules live in `server/services` and nowhere else, so an
API route, a server action, and a background job all enforce the identical rule.

```
app/                  Next.js App Router — (marketing), (auth), (app) route groups
components/           UI: primitives in ui/, feature components alongside
config/               env, plans, models, feature flags, constants
db/                   Prisma client singleton
lib/                  framework-agnostic pure helpers (money, dates, phone, crypto, ids)
prisma/               schema.prisma
server/
  actions/            server actions — thin adapters over services
  auth/               password hashing, session tokens, cookies
  authz/              the permission catalogue and role rules
  domain/             pure business rules, testable without a database
  errors/             the AppError hierarchy
  jobs/               queue, worker, handlers, drivers
  ratelimit/          fixed-window limiter
  repositories/       the only layer allowed to build a Prisma `where`
  services/           business logic and authorization
  tenancy/            request context resolution
  validation/         Zod schemas, shared by forms and actions
services/             provider adapters (WhatsApp, AI, storage, email, payments)
tests/                unit/, integration/, e2e/
tools/                the registry-free verification tools described above
```

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the long-form version.

---

## The rules that matter

These are load-bearing. [`CLAUDE.md`](CLAUDE.md) is the full set; these are the ones that cause real damage when
broken.

**Tenant isolation is enforced in three places.** The request context resolves `workspaceId` from the session,
never from user input. Repositories inject that scope into every `where` clause themselves. Single-record loads
verify the row's `workspaceId` after reading and throw `NotFoundError` — never `ForbiddenError`, because a 403
confirms the id exists in another tenant and lets an attacker enumerate.

**Authorization is checked in the service layer.** Hiding a button is a UX affordance. The team page renders its
controls from booleans the service computed with the same rule functions the mutations enforce, so the UI holds
no copy of the rules that could drift.

**Money is integer minor units with an explicit currency.** No floats, ever. All totals are computed server-side
from database prices; a total that arrives from a client or from a model is untrusted input.

**Webhook processing is idempotent.** Verify the HMAC over the raw body before parsing, dedupe on the provider
event id with a unique constraint, return 200 for an already-seen event.

**Secrets stay server-side.** All environment access goes through `config/env.ts`. No `process.env` in code that
can reach a client bundle; no secret in a `NEXT_PUBLIC_` variable.

**The AI never states a fact it did not retrieve or receive from a tool.** Prices, stock, delivery times,
policies, discounts, order status and payment confirmations come from tools or knowledge chunks. When the
support is absent, it says so and hands off. This is tested, not trusted. The AI has no direct database access —
tools only, each with a schema, a permission, an implicit workspace scope, and validation.

**Official WhatsApp Business Platform APIs only.** No web scraping, no QR session hacks, no browser automation,
no unsolicited mass messaging.

**No invented external APIs.** If the provider's current documentation cannot be read, the interface plus a
labelled mock implementation is the deliverable, and that is where it stops.

---

## Documentation

| Document | What is in it |
| --- | --- |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Phases, milestones, dependencies, risks, acceptance criteria |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layering, module boundaries, request lifecycle, provider abstractions |
| [CLAUDE.md](CLAUDE.md) | Engineering rules a change has to satisfy to be acceptable |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, conventions, indexes, migration workflow |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, tenant isolation, authn/authz, secrets, the acceptance tests |
| [docs/API.md](docs/API.md) | Response envelope, error codes, server actions, routes |
| [docs/TESTING.md](docs/TESTING.md) | What is tested where, how to run it, what is not covered yet |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable and what breaks without it |
| [docs/AI.md](docs/AI.md) | Prompt architecture, retrieval, tools, confidence, cost control |
| [docs/WHATSAPP.md](docs/WHATSAPP.md) | Cloud API integration, webhooks, message states, mock mode |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting, managed services, migrations, rollback |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What comes after the MVP, and what was deliberately deferred |

---

## Licence

Not yet licensed. All rights reserved pending a decision.
