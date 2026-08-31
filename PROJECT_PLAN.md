# PROJECT PLAN — WhatsApp OS

> Turn WhatsApp into your AI-powered business operating system.

This document is the single source of truth for *what* we are building, *in what order*, and *why*. It is
updated at the end of every phase. `ARCHITECTURE.md` covers how the system is put together; `CLAUDE.md`
holds the engineering rules that every change must follow.

---

## 1. Repository state at Phase 0

The repository was empty at the start of Phase 0. There was no `package.json`, no framework, no database, no
prior configuration, and no existing components. Every decision below is therefore greenfield, and nothing had
to be preserved or migrated.

That is worth recording because it removes a whole class of constraints: we get to pick strict TypeScript from
line one, we get to design the multi-tenant data model before any query exists that could bypass it, and we
never have to retrofit tenant scoping onto code that was written without it. Retrofitting tenant isolation is
the single most common way multi-tenant SaaS products leak customer data, so starting clean is a real
advantage that we intend to spend deliberately.

---

## 2. Product summary

Small businesses — the initial market is Pakistan, and the initial vertical is online clothing and general
e-commerce sellers — already run their customer operation on WhatsApp. They do it manually, which caps them at
the number of messages one person can type in a day and guarantees that follow-ups get forgotten.

WhatsApp OS connects a business's official WhatsApp Business number and puts an AI agent plus a real business
back-end behind it. The agent answers product and policy questions from the business's own data, captures and
qualifies leads, builds orders, and hands the conversation to a human the moment it should. The owner watches
and steers all of it from one dashboard.

The framing matters: this is not "a chatbot with a dashboard bolted on." The dashboard, the catalogue, the
order book, and the CRM are the product; the AI is the employee that operates them. Every design decision
should be checked against that framing.

---

## 3. Technology decisions

| Concern | Decision | Why this one |
| --- | --- | --- |
| Framework | Next.js (App Router) + React + TypeScript strict | Server Components let us keep tenant-scoped data access on the server by default, which is the security posture we want. One deployable unit for MVP. |
| Styling | Tailwind CSS + a hand-owned primitive layer in `components/ui` (shadcn/ui conventions) | Owning the primitives means no runtime dependency on a component registry, and we can theme for the "premium, minimal" brand direction. |
| Icons | Lucide | Consistent, tree-shakeable, matches the shadcn conventions. |
| Database | PostgreSQL + Prisma ORM | Relational data with hard foreign keys is exactly right for orders/inventory. Prisma gives us parameterised queries for free, which closes off SQL injection. `pgvector` gives us RAG retrieval in the same database. |
| Vector search | `pgvector` extension in the same PostgreSQL instance | One datastore to operate and back up. Retrieval joins naturally against tenant scoping. |
| Auth | First-party session layer: opaque 256-bit tokens, SHA-256 hashed at rest, `httpOnly`/`Secure`/`SameSite=Lax` cookies, scrypt password hashing via `node:crypto` | See §4 for the full rationale. This is the pattern Lucia's maintainer now recommends over a library, it adds zero native build risk, and every branch of it is unit-testable. |
| Queues / background jobs | `JobQueue` abstraction. Default driver is a PostgreSQL-backed queue with `FOR UPDATE SKIP LOCKED`; Redis/managed driver can be swapped in later | We refuse to make Redis a hard dependency for MVP. Postgres job queues are correct and durable at our scale. |
| AI | `AIProvider` abstraction; OpenAI-compatible driver first; deterministic mock driver for dev and tests | Model and vendor churn is guaranteed. The abstraction is not speculative generality — it is the thing that lets us run the whole test suite with no API key. |
| WhatsApp | `WhatsAppProvider` abstraction; official Meta WhatsApp Cloud API driver; mock driver behind `MOCK_WHATSAPP` | Unofficial automation violates Meta's terms and would kill the business. Non-negotiable. |
| Payments | `PaymentProvider` abstraction; Stripe driver for international; local Pakistani providers slot in later | We never touch raw card data. |
| Storage | `StorageProvider` abstraction; S3-compatible driver; local-disk driver for dev | Private buckets plus signed URLs. |
| Email | `EmailProvider` abstraction; console driver for dev | Transactional only for MVP. |
| Testing | Vitest for unit and integration; Playwright for the end-to-end acceptance walk | Vitest shares the TS/ESM config with the app. |
| Deployment | Vercel-style app hosting, managed Postgres, S3-compatible storage; Docker Compose for local parity | Documented in `DEPLOYMENT.md`. |

### 3.1 What we deliberately are *not* doing in MVP

Voice calling, Instagram and Messenger channels, multiple concurrent AI agents per workspace, a visual
drag-and-drop automation canvas, and campaign sending are all out of MVP scope. Each one has an architectural
seam reserved for it (`ChannelProvider`, the `AIAgent` table being a collection rather than a singleton, the
trigger/action tables being data rather than code), but building them now would delay the core loop that
actually has to work first.

---

## 4. The authentication decision, in full

The brief asked us to prefer Auth.js, Better Auth, or Clerk and to avoid insecure custom authentication. We
are implementing a first-party session layer instead, and because that reads as going against the brief, here
is the reasoning.

Clerk is a hosted service. It would make local development, the test suite, and the seed data all depend on an
external account and live API keys. For a product whose seed and mock modes are explicit requirements, that is
a bad trade.

Auth.js and Better Auth are both good libraries, but the risk they carry here is specific: their APIs move
between minor versions, and inventing an API surface for a library is exactly the failure mode the brief
forbids elsewhere. We would be reading `.d.ts` files to reconstruct usage.

The decisive point is that the "roll your own session" pattern is no longer the risky option it once was.
Lucia — the library that owned this space — was intentionally wound down in favour of a reference
implementation that developers copy into their own codebase, precisely because session management is a small,
well-understood, stable amount of code. What we implement is that pattern:

- Passwords hashed with **scrypt** from `node:crypto`, at OWASP-recommended cost parameters, with a
  per-password random salt and a versioned encoding string so parameters can be upgraded in place. scrypt is
  an OWASP-accepted password KDF, and using the Node standard library means no native module build step and no
  supply-chain surface.
- Session tokens are **32 bytes of CSPRNG output**, base32-encoded for the cookie. The database stores only a
  **SHA-256 hash** of the token, so a database read alone cannot be replayed as a session.
- Cookies are `httpOnly`, `Secure` in production, `SameSite=Lax`, host-scoped, with an absolute expiry and
  sliding renewal at the halfway point.
- Constant-time comparison everywhere a secret is checked; a dummy hash verification on unknown emails so
  login timing does not disclose whether an account exists.
- Rate limits on login, signup, and password reset, keyed on both identifier and IP.

The password-hashing implementation sits behind a `PasswordHasher` interface, so moving to Argon2id later is a
one-file change. If the project later wants a managed identity provider, the `server/auth` module is the only
place that has to change — nothing outside it knows how a session is established.

---

## 5. Multi-tenancy model

A **Workspace** is the tenant. A **User** is a person, and a person may belong to several workspaces through
**WorkspaceMember**, which carries their role in that workspace.

Every tenant-owned table has a non-nullable `workspaceId` foreign key. There is no such thing as a global
product, order, contact, or conversation.

Isolation is enforced in three layers, deliberately redundant:

1. **Request context.** Resolving the current request produces a `TenantContext` containing the authenticated
   user, the active workspace, and the caller's role. There is no code path that reads tenant data without
   one.
2. **Scoped data access.** Repositories accept a `TenantContext` and inject `workspaceId` into every `where`
   clause. Cross-tenant reads are not "blocked" so much as unexpressible — the function signature does not
   let you ask the question.
3. **Post-read assertion.** Helpers that load a single record by id re-check `record.workspaceId` against the
   context before returning it, and throw `NotFoundError` (never `ForbiddenError`) on mismatch, so probing for
   ids in another tenant cannot distinguish "exists elsewhere" from "does not exist".

Frontend filtering is never treated as isolation. It is a rendering concern only. Phase 9 adds PostgreSQL
row-level security as a fourth layer for defence in depth.

---

## 6. Roles and permissions

Five roles, ordered by capability: `OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `VIEWER`.

Permissions are modelled as explicit `resource:action` strings mapped to the roles that hold them, not as a
numeric rank comparison. Rank comparison seems simpler right up until a role needs a capability that a
nominally higher role should not have — for example, only `OWNER` may transfer ownership or cancel the
subscription, and that is not expressible as "level ≥ N".

Authorization is checked server-side inside the service layer, next to the data access, rather than in route
handlers or components. Hiding a button is a UX affordance and is never the enforcement point.

---

## 7. Implementation phases

Each phase has an explicit exit gate. A phase is not done because the code exists; it is done when lint,
typecheck, tests, and build all pass, the UI has been inspected, and the docs are updated.

| Phase | Scope | Exit gate |
| --- | --- | --- |
| **0** | Repo inspection, planning docs, project scaffold, config and feature-flag system, plans config, full Prisma schema, migrations, Docker Compose, `.env.example` | Schema validates; client generates; `tsc`, lint, and build pass on the shell |
| **1** | Auth (signup/login/logout/session), workspace creation, members and roles, authorization layer, tenant context, rate limiting, audit log, API envelope, dashboard shell, UI primitive kit, landing page, onboarding checklist | Tenant-isolation and RBAC unit tests pass; the Workspace A vs B acceptance test from §96 of the brief passes; build passes |
| **2** | Contacts/CRM, products with variants and inventory, orders with server-side totals, payments records, full CRUD with validation and authorization, seed data | Order-total test (Rs. 7,248 case) passes; inventory cannot go negative; seed produces a usable dashboard |
| **3** | Conversation inbox (three-column desktop, mobile-adaptive), messages, message states, attachments, mock WhatsApp driver, message simulator | A simulated inbound message appears in the inbox and can be replied to; states transition correctly |
| **4** | Real Meta WhatsApp Cloud API integration in 5 units: Unit 1 Provider (`a823b83`), Unit 2 Webhook Receiver (`8b857df`), Unit 3 Webhook Processor (`75360a5`), Unit 4 WhatsApp Account UI (`9f28ecb`), Unit 5 Final Integration / Acceptance Suite (`96efc21`). Media download/storage deferred. | **Complete & Released** across all 5 units |
| **5** | AI agent config, prompt architecture, Gemini provider, knowledge base ingestion, chunking, embeddings, RAG retrieval, tool registry with validated tools (including `create_order`), human handoff orchestration, AI test playground | **Complete & Released (`69a615a`, `0e3a909`)** — all AI acceptance tests pass |
| **6** | Automation engine, trigger matching, multi-step actions, WAIT / delayed resumption, automation builder UI, in-app notification center, conversation idle scanner, async worker handlers, handoff integration | **Complete & Released (`69b98d3`, `217d8ea`, `3408a8b`, `a2fe14c`)** — all Phase 6 acceptance tests pass |
| **7** | Analytics aggregation, usage metering per workspace, AI cost attribution, dashboard charts | **Next Milestone** — metrics match hand-computed values against seed data |
| **8** | Plans, subscriptions, trial, limit enforcement, graceful degradation at limits, billing UI | Exceeding a limit restricts rather than deletes; plan config drives every limit |
| **9** | Security hardening (headers, CSP, RLS), full test sweep, performance and index review, accessibility pass | The four critical acceptance tests all pass; axe reports no serious violations |
| **10** | Production deployment guide, health checks, observability interfaces, backup and restore runbook | A clean deploy from documentation alone |
| **11** | Post-MVP: campaigns, appointments, message templates, voice ingest, multi-channel, multiple agents | Per-feature, behind feature flags |

---

## 8. Dependency order

Some sequencing is forced and worth stating so we do not accidentally reorder it.

The database schema has to exist before authentication, because sessions live in it. Authentication and the
tenant context have to exist before any domain feature, because every domain query takes a `TenantContext`.
Products and contacts have to exist before orders, because orders reference both and the order total is
computed from product prices held server-side. Conversations have to exist before the AI agent, because the
agent's input is a conversation. The knowledge base and the product catalogue both have to exist before the AI
can be tested honestly, since the entire point of the grounding tests is that the agent reads real data.
Usage metering has to exist before billing limits can be enforced, and analytics depends on there being events
to aggregate.

Automation and notifications depend on the job queue, which is why the queue lands in Phase 0 as
infrastructure rather than in Phase 6 as a feature.

---

## 9. Risks and mitigations

**WhatsApp Business Platform access is slow and gated.** A business must complete Meta verification before it
can message freely, and we cannot control that timeline. Mitigation: the mock driver is a first-class citizen,
not an afterthought. The entire product is developable and demonstrable without a single real credential, and
`MOCK_WHATSAPP` is loud about which mode is active so we can never confuse the two.

**AI hallucination is an existential product risk.** If the agent invents a price or promises a refund policy
the business does not have, the business loses money and trust, and they will blame us. Mitigation: the agent
answers from retrieved evidence and tool results only. Prices, stock, order status, and policies come from
tools, never from the model's own memory. A grounding check runs before send, and anything unsupported becomes
an explicit "I don't have that information" plus a handoff. This is enforced by tests that change stock to zero
and assert the agent stops saying "available".

**AI cost can run away.** An unmetered agent plus a malicious user is an unbounded bill. Mitigation: per-workspace
usage records written on every call, per-user and per-workspace rate limits, a hard cap on output tokens, a
bounded context window built from a rolling summary plus recent messages rather than full history, and cheaper
models routed to simple tasks.

**Cross-tenant data leakage.** The worst possible bug. Mitigation: the three-layer model in §5, an explicit
adversarial test, and RLS in Phase 9.

**Webhook duplication and reordering.** Meta retries, and retries arrive out of order. Mitigation: a
`WebhookEvent` table keyed on provider event id with a unique constraint, processed inside a transaction, so
replay is a no-op rather than a duplicate order.

**Scope. This brief is very large.** The honest risk is building twenty features to 60% instead of the core
loop to 100%. Mitigation: the phase gates, and a standing rule that nothing ships behind a "Coming soon"
label — a feature is either working or absent.

---

## 10. Definition of done for the MVP

The MVP is complete when a person can sign up, create a business, add a product with price and stock,
configure the AI agent, add knowledge, open the playground and ask "Black kurta XL available?", get an answer
that came from the actual product row, simulate an inbound WhatsApp message, watch it land in the inbox and be
answered, see the contact created, place an order through the conversation, find that order in the dashboard
with a server-computed total, take over the conversation, pause and resume the AI, and read analytics and
usage — with workspace isolation and role permissions verified by tests, and with lint, typecheck, tests, and
production build all green.

---

## 11. Status log

| Date | Phase | Status |
| --- | --- | --- |
| 2026-08-26 | 0 | **Complete** — config, feature flags, plan config, full Prisma schema (52 models, 40 enums), job queue, logger, error types, API envelope, sandbox verification gate |
| 2026-08-27 | 1 | **Complete** — authentication, sessions, workspaces, members and roles, permission catalogue, tenant context and scoped repositories, rate limiting, audit log, dashboard shell |
| 2026-08-27 | 2 | **Complete** — contacts/CRM, products with variants and inventory, orders with server-side totals, seed data |
| 2026-08-28 | 3 | **Complete** — conversation inbox, messages, message states, attachments, mock WhatsApp provider foundation, e2e simulator |
| 2026-08-28 | 4 (Unit 1) | **Complete & Committed (`a823b83`)** — Meta WhatsApp Cloud API Provider adapter (`MetaWhatsAppProvider`) |
| 2026-08-28 | 4 (Unit 2) | **Complete & Committed (`8b857df`)** — Meta WhatsApp Webhook Receiver route (`/api/webhooks/whatsapp`) with HMAC verification & deduplication |
| 2026-08-28 | 4 (Unit 3) | **Complete & Committed (`75360a5`)** — WhatsApp Webhook Processor service & background job handlers |
| 2026-08-28 | 4 (Unit 4) | **Complete & Committed** — WhatsApp Account Connection & Management UI (`app/(app)/(workspace)/settings/whatsapp/`) |
| 2026-08-29 | 4 (Unit 5) | **Complete & Committed** — Final Meta WhatsApp Text Acceptance Suite |
| 2026-08-29 | 5 | **Complete & Committed (`69a615a`, `0e3a909`)** — AI agent runtime, prompt assembly, Gemini provider, Knowledge Base RAG grounding, tool registry, order creation write tool, human handoff, and master AI acceptance tests |
| 2026-08-30 | 7 (Unit 1) | **Complete & Committed (`d535f40`)** — Analytics aggregation engine, usage metering per workspace, AI cost attribution, and daily rollups |
| 2026-08-30 | 7 (Unit 2) | **Complete & Committed (`9b73360`)** — Analytics dashboard UI, metric KPI grids, Recharts visualization, and usage metering views |
| 2026-08-30 | 7 (Unit 3) | **Complete & Committed (`3587f7e`)** — Master Phase 7 acceptance suite, RFC 4180 CSV/JSON export engine, and background daily rollup job integration |
| 2026-08-31 | 8 (Unit 1) | **Complete & Committed (`ce77f59`)** — Subscription lifecycle, trial expiration fallback, plan changes, cancel/resume operations, and centralized quota limit & entitlement enforcement engine |
| 2026-08-31 | 8 (Unit 2) | **Complete** — Billing management UI (`/settings/billing`), plan comparison, quota usage metering visualization, and write-path enforcement (products, contacts, team members) |
| 2026-08-31 | 9 (Unit 1) | **Complete & Committed (`108584c`)** — Security hardening (strict CSP & headers, active session revocation wiring, comprehensive rate-limit attachment, and PostgreSQL RLS architecture) |
| 2026-08-31 | 9 (Unit 2) | **Complete & Committed (`94a8a41`)** — Performance indexes, partial unique constraints, and data pruning |
| 2026-08-31 | 9 (Unit 3) | **Complete & Committed (`cf7d193`)** — Observability, Prometheus metrics registry (`/api/metrics`), health and readiness probes (`/api/health/*`), and audit log export |
| 2026-08-31 | 10 (Unit 1) | **Complete** — CI automation pipeline (`.github/workflows/ci.yml`), `pgvector` container test integration, and security vulnerability policy (`SECURITY.md`) |
| 2026-08-30 | Deferred | Media download/storage, Campaigns, Voice, Multi-channel expansion |

