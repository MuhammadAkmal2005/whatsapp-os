# Roadmap

`PROJECT_PLAN.md` holds the phase plan and its exit gates. This document holds the two things that plan cannot:
the **known gaps** carried forward as a debt register, and what was **deliberately deferred** along with why.

The register matters because every one of these was found and written down rather than forgotten. A gap that is
recorded is a decision; a gap that is not is a surprise for whoever hits it.

---

## Where the build is

Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, and Phase 7 are complete:
- **Phase 0–3**: Project scaffold, full Prisma schema, multi-tenant auth & sessions, RBAC, CRM, products/orders, inbox UI, mock simulator.
- **Phase 4**: Meta WhatsApp Cloud API Provider (`MetaWhatsAppProvider`), signed webhook receiver, webhook processor job worker, account management UI, and master text acceptance suite.
- **Phase 5**: AI agent runtime, prompt assembly, Gemini provider, Knowledge Base RAG grounding with vector similarity, tool registry, order creation write tool, human handoff, and master AI acceptance tests.
- **Phase 6**:
  - **Unit 1 (`69b98d3`)**: Automation engine, trigger matching, action execution, wait/resume queue orchestration, and deduplication.
  - **Unit 2 (`217d8ea`, `3408a8b`)**: Automation builder UI, server actions, in-app notification center & bell, and conversation idle scanner.
  - **Unit 3 (`a2fe14c`)**: Master Phase 6 Acceptance Suite, background job handlers (`whatsapp.send_message`, `notification.deliver`), end-to-end handoff, wait-then-act resumption, and notification lifecycle.
- **Phase 7**:
  - **Unit 1 (`d535f40`)**: Analytics aggregation engine, usage metering per workspace, AI cost attribution, and daily rollups.
  - **Unit 2 (`9b73360`)**: Analytics dashboard UI, metric KPI grids, Recharts visualization, and usage metering views.
  - **Unit 3 (`3587f7e`)**: Master Phase 7 acceptance suite, RFC 4180 CSV/JSON export engine, and background daily rollup job integration.
- **Phase 8**:
  - **Unit 1 (`ce77f59`)**: Subscription lifecycle, trial expiration fallback, plan changes, cancel/resume operations, and centralized quota limit & entitlement enforcement engine.
  - **Unit 2**: Billing management UI (`/settings/billing`), plan comparison, quota usage metering visualization, and write-path enforcement (products, contacts, team members).

  - **Unit 3 (`441a033`, `47d76e0`)**: Payment provider integration (Stripe/mock checkout & webhook handling) and Master Phase 8 acceptance suite.
- **Phase 9**:
  - **Unit 1 (`108584c`)**: Security hardening (strict CSP & headers, active session revocation wiring, comprehensive rate-limit attachment, and PostgreSQL RLS architecture).
  - **Unit 2 (`94a8a41`)**: Database performance optimization, composite indexes for high-volume queries, partial unique indexes for InventoryItem & AIAgent, job claim query optimization (`FOR UPDATE SKIP LOCKED`), and periodic maintenance sweep retention pruning.
  - **Unit 3 (`cf7d193`)**: Observability, OpenTelemetry & Prometheus-compatible metrics registry (`/api/metrics`), health and readiness probes (`/api/health`, `/api/health/liveness`, `/api/health/readiness`), background worker telemetry, and tenant-isolated audit log export engine (`/api/audit/export`, server actions).
- **Phase 10**:
  - **Unit 1**: Automated CI quality gate (`.github/workflows/ci.yml`), `pgvector` container test runner, security vulnerability disclosure policy (`SECURITY.md`), and production environment validation.

**The test and verification gate is active.** Full regression test suite, TypeScript strict typecheck, ESLint, Next.js production build, and automated CI pass.

---

## Known gaps

Ordered by what would hurt most if it shipped as-is.

### Correctness

**No Playwright config.** `npm run test:e2e` is wired and `@playwright/test` is installed, but `playwright.config.ts`
and `tests/e2e/` do not exist, so the command fails.

**Deleting a variant does not check its reserved stock.** `deleteVariant` removes the size and, by cascade, its
`InventoryItem` row — including any `reserved` units held by an unconfirmed order. The order itself survives
intact, because `OrderItem` carries `variantSnapshot` and the price it was sold at and its FK is `SetNull`, so
nothing a customer was promised is lost. What is lost is the reservation: the units silently stop being counted as
held. The check belongs with orders rather than with the catalogue — the product service has no business deciding
what a reservation means — so it lands with Phase 2's order work, as a refusal to delete a variant that an open
order is holding.

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

**Media Download and Storage.** Inbound media attachment downloads (images/audio/documents) and S3 storage persistence are deliberately deferred from Phase 4 text-first Cloud API integration. Media processing arrives in a subsequent media-handling phase.

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

**Editing a customer's phone number, and merging duplicates.** `updateContactSchema` deliberately omits the phone
number. It is half of `@@unique([workspaceId, phoneE164])` — the contact's identity — so changing it silently
re-points every conversation, order and payment already attached to that record at a different person. What a shop
owner actually wants when they reach for it is a *merge*: two records for one customer, usually because the number
was saved once with the country code and once without. That is its own operation, with its own confirmation screen
and a decision about which record's history survives, and it is Phase 11 work rather than a field on the edit form.

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
