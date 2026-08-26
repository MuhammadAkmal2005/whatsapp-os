# Roadmap

`PROJECT_PLAN.md` holds the phase plan and its exit gates. This document holds the two things that plan cannot:
the **known gaps** carried forward as a debt register, and what was **deliberately deferred** along with why.

The register matters because every one of these was found and written down rather than forgotten. A gap that is
recorded is a decision; a gap that is not is a surprise for whoever hits it.

---

## Where the build is

Phase 0 and Phase 1 are built: configuration, feature flags, plan config, the full Prisma schema, the job queue,
authentication, workspaces, members and roles, the authorization layer, tenant context, rate limiting, audit
logging, the API envelope, the dashboard shell and the documentation set.

Phases 2 through 10 are not started. Phase 2 is next: contacts, products with variants and inventory, orders with
server-side totals, and seed data.

**The verification gate has not run in full.** Lint, typecheck, `next build`, Prisma migration generation and
Playwright all still need a machine with a package registry and a PostgreSQL instance. `npm run verify:sandbox`
covers syntax, first-party imports and 282 unit tests, and that is genuinely all it covers. `docs/TESTING.md` is
precise about the difference.

---

## Known gaps

Ordered by what would hurt most if it shipped as-is.

### Blocks the next phase

**`prisma/migrations/` does not exist.** The schema is complete and validated by reading, but no migration has
been generated, so no database has ever been created from it. Generating it must be treated as a step that can
fail. The initial migration also has to create the `vector` and `pg_trgm` extensions and add the HNSW index on
`knowledge_chunks.embedding` — without that index, retrieval degrades to a sequential scan over every chunk.

**`db/seed.ts` does not exist**, so `npm run db:seed` fails. It arrives with Phase 2. It must create a *second*
workspace, because the cross-tenant acceptance test needs two tenants to prove isolation between, and a
single-tenant seed cannot fail in the way that matters.

### Correctness

**`tests/setup.ts` and the `server-only` Vitest alias have never executed.** Both were written to fix problems
reasoned about rather than observed: the setup file was referenced by `vitest.config.ts` and missing, which would
have failed `npm run test` on the first full install, and the alias exists because `server-only` throws outside the
`react-server` condition and 28 modules import it. The reasoning is sound and untested, which is not the same as
working.

**No CI.** `npm run verify` on every pull request, against a Postgres service container. Until this exists, "the
tests pass" means "they passed for whoever last remembered to run them."

**No Playwright config.** `npm run test:e2e` is wired and `@playwright/test` is installed, but `playwright.config.ts`
and `tests/e2e/` do not exist, so the command fails.

**`AIAgent.isDefault` has no constraint behind it.** It is `Boolean @default(true)` with no unique index, so
creating a second agent in a workspace produces two rows both claiming to be the default and the turn pipeline has
no defined answer for which one replies. Harmless while the MVP configures one agent, and it must be a partial
unique index — one `isDefault = true` per workspace — before multiple agents ship. Recorded here because the
default value makes the wrong state the *easy* one to reach.

### Security

**Session revocation has no caller.** `revokeAllSessions(userId)` exists in
`server/services/auth/session.service.ts` and is never called: there is no password-change flow, and a role change
does not revoke the affected member's sessions. A demotion therefore takes effect on the member's *next* context
resolution rather than instantly. That is acceptable today only because the tenant context re-reads the role from
the database on every request — it must become a real revocation before password change ships.

**No security contact or disclosure policy.** Acceptable pre-launch with no external users, and a launch blocker
the moment that changes.

**No privacy policy.** This product holds customer data belonging to third parties.

**Row-level security is not implemented.** Isolation is currently an application guarantee across three redundant
layers, which is why it is tested rather than assumed. RLS would make it a property of the database instead.
Planned for Phase 9, deliberately after the query surface stops moving, because it needs a connection wrapper that
sets a session variable per request.

**Rate limits are defined but mostly unattached.** Authentication and team invitations are wired. The limits for AI
requests, message sending, file uploads, public API routes and webhooks exist in `RATE_LIMITS` and attach as each
feature lands. **An AI endpoint must not ship without its limit attached** — an unmetered path to a paid model is a
way for a stranger to spend our money.

### Operations

**No error monitor, log aggregator, uptime checks or alerts.** `lib/logger.ts` is the seam they attach to. The
failure most likely to go unnoticed is a silently dead worker: uploaded documents sit at `PENDING` forever while
the product looks entirely healthy.

**No tested backup.** Managed Postgres with point-in-time recovery, and a restore that has actually been performed.
An untested backup is a belief.

---

## Deliberately deferred

These are choices, not omissions, and each buys something.

**Redis.** `QUEUE_DRIVER=postgres` uses `FOR UPDATE SKIP LOCKED` and needs no broker — one fewer service to run,
back up, monitor and pay for. At MVP volumes the throughput difference is irrelevant. Revisit when queue depth
justifies it.

**A separate backend service.** Next.js server-side handles the MVP. Splitting it out later is a known, bounded
piece of work; doing it now would cost a deployment target and a network hop for no present benefit.

**Multi-channel.** Instagram, Messenger, web chat, SMS and email. What exists today is the *data* seam:
`Conversation.channel` is a `Channel` enum already carrying all six values, so the inbox does not assume WhatsApp.
The `ChannelProvider` interface itself is not written — it arrives with the second channel. Building five adapters
before one channel is proven is the wrong order.

**Multiple AI agents.** The schema already carries `AgentRole` with `SALES_SUPPORT`, `SALES`, `SUPPORT`,
`RECEPTIONIST`, `ORDER_TAKER` and `FOLLOW_UP`, and `AIAgent` is a per-workspace collection rather than a singleton.
The MVP configures one. A business that cannot get one agent working well does not want four.

**Voice.** Inbound voice notes transcribe to text and then follow the ordinary path, which is a clean addition
behind `ENABLE_VOICE`. Realtime voice calling is a different product and is not on this roadmap.

**Campaigns and appointments.** Both are behind flags (`ENABLE_CAMPAIGNS`, `ENABLE_APPOINTMENTS`) and land in
Phase 11. Campaigns in particular must not ship before the 24-hour window, template approval and opt-out are all
enforced, because a campaign feature that ignores them is a spam tool that costs every tenant their number.

**Local Pakistani payment providers.** The `PaymentProvider` interface is the right shape for them; the integrations
need a real business entity and merchant accounts, so Stripe is the first implementation and local providers follow.

**A public API.** Needs per-workspace API keys, a versioned contract, scoped read-only permissions and its own
rate-limit tier — `publicApi` is already configured at 100 requests per minute. Not before customers ask.

**Urdu dashboard and RTL.** UI strings live in the localisation structure rather than hard-coded, so this is
additive. The dashboard is English for now; the *agent* handles Urdu and Roman Urdu from the start, which is the
part customers actually experience.

---

## Post-MVP, roughly in order

Campaigns with proper window and opt-out handling. Appointments as a generic module, which unlocks salons,
clinics and tutors. Message template management against Meta's real approval flow. Voice note ingestion. The
platform admin panel — the architecture is separated already, so this is UI over existing data. Multiple agents.
Then a second channel, chosen by what customers ask for rather than by what is technically interesting.

Row-level security, a tested restore runbook and CI are not on this list because they are not post-MVP. They are
Phase 9 and Phase 10.
