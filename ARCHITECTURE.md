# ARCHITECTURE — WhatsApp OS

This document describes how the system is put together and why it is shaped this way. It is the reference a new
engineer should read before touching code. `PROJECT_PLAN.md` covers scope and sequencing; `CLAUDE.md` covers the
rules a change must obey.

---

## 1. The shape of the system

There is one deployable application. It serves the marketing site, the authenticated dashboard, the API, and
the webhook endpoints. Behind it sit one PostgreSQL database and a set of provider adapters that talk to the
outside world.

```
                          ┌──────────────────────────────┐
   WhatsApp customer ───► │  Meta WhatsApp Cloud API     │
                          └──────────────┬───────────────┘
                                         │ webhook (signed)
                                         ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │                        WhatsApp OS application                            │
 │                                                                           │
 │  app/            Next.js routes — marketing, dashboard, API, webhooks     │
 │  features/       feature-scoped UI: components, forms, view models        │
 │  components/ui/  design-system primitives                                 │
 │  ─────────────────────────────────────────────────────────────────────    │
 │  server/                                                                  │
 │    auth/         sessions, passwords, cookies                             │
 │    tenancy/      TenantContext resolution, workspace scoping              │
 │    authz/        permission catalogue and role mapping                    │
 │    services/     domain logic — the only place business rules live        │
 │    repositories/ tenant-scoped data access                                │
 │    validation/   Zod schemas shared by API and forms                      │
 │    jobs/         queue, worker, handlers                                  │
 │  ─────────────────────────────────────────────────────────────────────    │
 │  services/       outward-facing provider adapters                         │
 │    whatsapp/  ai/  payments/  storage/  email/                            │
 └────────────────────────┬──────────────────────────────────────────────────┘
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
      PostgreSQL + pgvector      S3-compatible storage
      (data, queue, vectors)     (media, documents)
```

The layering rule is one-directional and absolute: routes call services, services call repositories and
providers, repositories call Prisma. Nothing calls upward. A route handler never touches Prisma; a repository
never knows about HTTP. This is what makes the tenant guarantee auditable — there is exactly one layer where
`workspaceId` can be forgotten, and it is small enough to read in full.

---

## 2. Directory layout

```
app/
  (marketing)/            public landing, pricing, legal
  (auth)/                 login, signup, password reset
  (dashboard)/            authenticated application
    [workspace]/          workspace-scoped pages
  api/
    webhooks/whatsapp/    GET verify, POST receive
    ...                   REST endpoints, all returning the standard envelope
components/
  ui/                     Button, Card, Input, Table, Dialog, Badge, Skeleton, EmptyState, ...
  layout/                 AppShell, Sidebar, Topbar, WorkspaceSwitcher
features/
  auth/  dashboard/  contacts/  products/  orders/  inbox/
  agent/  knowledge/  automation/  analytics/  settings/  billing/
server/
  auth/     tenancy/  authz/  services/  repositories/  validation/  jobs/  errors/
services/
  whatsapp/ ai/  payments/  storage/  email/     (each: index.ts, types.ts, providers/)
lib/                      framework-agnostic helpers — money, dates, ids, crypto, result
config/                   env parsing, plans, feature flags, models, constants
db/                       prisma client singleton, seed, fixtures
prisma/                   schema.prisma, migrations/
types/                    shared ambient and domain types
tests/
  unit/  integration/  e2e/
docs/                     the .md reference set
```

Feature folders own their UI and their view models. They do not own business rules — those live in
`server/services` so that an API route, a server action, and a background job all enforce the same thing. When
the same rule exists in two places it will eventually exist in two *different* forms, and the version that is
wrong will be the one that runs.

---

## 3. Request lifecycle

An authenticated request goes through the same six steps every time.

The session cookie is read and its token hashed and looked up, producing the user or nothing. The active
workspace is resolved from the route segment and checked against the user's memberships, producing a
`TenantContext` of `{ user, workspace, role, membershipId }` or a redirect. The request body is parsed by a Zod
schema, so nothing downstream handles an unvalidated shape. A permission check runs against the required
`resource:action` for the operation. The service executes, taking the context as its first argument. The result
is serialised into the standard envelope, and anything that mutated sensitive state writes an audit entry.

Failures are converted centrally. A thrown `AppError` subclass carries a stable machine code, an HTTP status,
and a message safe to show a user; anything else becomes a generic 500 with a request id, and the real detail
goes only to the structured log. Users never see a stack trace.

---

## 4. Tenancy

`Workspace` is the tenant boundary. Every tenant-owned row carries a non-nullable `workspaceId`.

Repositories take `TenantContext` as their first parameter and are the only code permitted to build a Prisma
`where` clause. Each one injects `workspaceId` from the context rather than from anything the caller supplied.
A caller cannot request another tenant's data because there is no parameter through which to ask.

Single-record loads by id add a post-read check: if the loaded row's `workspaceId` does not match the context,
the helper throws `NotFoundError` rather than a forbidden error. Returning "forbidden" would confirm that the
id exists somewhere in the system, which is an information leak that lets an attacker enumerate another
tenant's records. Indistinguishability matters more than accuracy here.

Cross-tenant tables are few and explicitly marked: `User`, `Plan`, `WebhookEvent` before routing, and the
platform-admin views. Every one of them is called out in `DATABASE.md`.

Phase 9 adds PostgreSQL row-level security using a per-transaction `app.workspace_id` setting, as a fourth
layer beneath the three above. It is defence in depth, not the primary mechanism — a policy that is only ever
exercised by correct code provides no signal that the code is correct.

---

## 5. Authorization

Permissions are strings of the form `resource:action` — `product:update`, `order:refund`,
`subscription:manage`, `member:invite`. A static catalogue maps each role to the set it holds.

The check is a set membership test, not a rank comparison. That distinction exists because rank comparison
cannot express the cases we actually have: `OWNER` alone may transfer ownership or cancel billing, and an
`ADMIN` outranks a `MANAGER` on settings while having no special claim on an individual conversation
assignment.

Checks live inside services, adjacent to the data they guard. Route handlers do not carry authorization logic,
because a second entry point to the same service would then be unprotected. UI gating derives from the same
catalogue so that what a user sees and what a user may do cannot drift apart, but the UI is never the
enforcement point.

---

## 6. Provider abstractions

Five outward-facing concerns are abstracted behind interfaces: WhatsApp, AI, payments, storage, and email. Each
lives in `services/<name>` (and `server/services/<name>`) with interface declarations, `providers/` directory implementations,
and factory methods (`WhatsAppProviderFactory`) that resolve between mock and live instances.

For WhatsApp, `WhatsAppProviderFactory` dynamically instantiates `MetaWhatsAppProvider` or `MockWhatsAppProvider` based on workspace account credentials or runtime environment variables (`MOCK_WHATSAPP`). Access tokens are encrypted at rest with `encryptSecret` using `AUTH_SECRET` and are decrypted strictly on the server-side when instantiating the live Meta client.

This is not abstraction for its own sake. It buys three concrete things. The test suite and the seed script run
against deterministic mock drivers with no credentials and no network, which is what makes the acceptance tests
in `PROJECT_PLAN.md` runnable in CI. Vendor substitution — a local Pakistani payment processor next to Stripe,
a different model vendor next quarter — becomes a new file rather than a refactor. And it forces every external
call through a single chokepoint where we can put retries, timeouts, logging, and usage metering once.

The interfaces are written to the *capabilities we actually use*, not to a lowest common denominator invented in
advance. `WhatsAppProvider` exposes sending text, media, and templates, plus webhook parsing and signature
verification, because that is what the Cloud API does. We do not add methods for capabilities WhatsApp does not
have, and the UI does not offer them.

---

## 7. WhatsApp integration

Two endpoints and a background processor. `GET /api/webhooks/whatsapp` answers Meta's verification challenge by comparing
`hub.verify_token` against `WHATSAPP_VERIFY_TOKEN` in constant time and echoing `hub.challenge`.
`POST /api/webhooks/whatsapp` receives events.

The POST path is deliberately paranoid, in this order. The raw body is read *before* any JSON parsing, because
the `X-Hub-Signature-256` HMAC is computed over exact bytes and re-serialising would break it. The signature is
verified against `META_APP_SECRET` with a timing-safe comparison, and a failure returns 401 without touching
the database. The envelope is then parsed by `parseWebhookLogicalEvents` (`server/services/whatsapp/webhook.parser.ts`), and each contained event is recorded as a `WebhookEvent` keyed on `(provider, providerEventId)` with a unique constraint for deduplication. A duplicate insert is caught and returned 200 immediately. New events trigger an enqueued background job `whatsapp.process_webhook` and return 200 fast to satisfy Meta's short HTTP timeout.

Inbound routing maps the receiving `phone_number_id` to a `WhatsAppPhoneNumber` row, resolving the owning `workspaceId`. The background job handler (`server/jobs/handlers/whatsapp-webhook.handler.ts`) delegates to `webhook-processor.service.ts`, executing `processInboundMessage` or `processStatusUpdate`, updating `WebhookEvent` status (`RECEIVED` → `PROCESSING` → `PROCESSED` / `FAILED`).

WhatsApp Account Connection & Management UI (`app/(app)/(workspace)/settings/whatsapp/`) allows workspace OWNERs and ADMINs to connect, view, and disconnect WhatsApp credentials. When `MOCK_WHATSAPP=false`, live credential validation (`validateMetaCredentials`) verifies the supplied access token and `phoneNumberId` against Meta Graph API (`GET /v21.0/{phoneNumberId}`) before persisting. Access tokens are encrypted server-side and never returned in overview DTOs or form states.

`MOCK_WHATSAPP=true` swaps in a driver that records outbound sends to the database instead of the network and
exposes a simulator for inbound messages and status callbacks. The mode is surfaced in the UI. Sending a real
message from a development environment must be impossible by construction, not by remembering.

---

## 8. Message model and states

Messages carry a `direction` (`INBOUND`/`OUTBOUND`), a `type` (text, image, video, audio, document, sticker,
location, interactive, template), a `status`, and the provider's message id.

Outbound status advances `QUEUED → SENDING → SENT → DELIVERED → READ`, with `FAILED` reachable from any
pre-delivery state. Status callbacks arrive out of order, so transitions are monotonic: a `SENT` callback
arriving after `READ` is discarded rather than applied. Without that rule, a late retry silently regresses the
UI and makes read receipts untrustworthy.

Attachments are rows referencing storage keys, never bytes in the database. Inbound media is fetched by a
background job, validated for MIME type and size, and stored privately; the UI reads it through short-lived
signed URLs.

---

## 9. The AI agent

The agent is a service, not a prompt string embedded in a component. `services/ai` holds the provider drivers;
`server/services/agent` holds the orchestration.

A turn runs as follows. Conversation context is assembled from a rolling summary plus a bounded window of
recent messages — never the full history, because full history is both expensive and the main driver of
context-window failures. The customer's message is used to retrieve relevant knowledge chunks by vector
similarity, scoped to the workspace. The system prompt is composed from the business profile, the agent's
configured persona and tone, the retrieved chunks, and structured customer context. The model is called with a
registry of tools. Tool calls are validated, authorized, executed, and their results fed back. The candidate
reply then passes a grounding check before it is sent.

**Grounding is the important part.** The agent is not permitted to state a price, a stock level, a delivery
time, a policy, a discount, an order status, or a payment confirmation unless that fact came from a tool result
or a retrieved chunk in this turn. When the support is missing, the reply is replaced with an explicit
"I don't have that information right now — let me connect you with our team" and the conversation is escalated.
This is enforced by tests that set stock to zero and assert the word "available" stops appearing, and that ask
for a return policy that does not exist and assert none is invented.

Confidence is computed from evidence, not asked of the model. A model's self-reported confidence is a fluent
guess and correlates poorly with correctness. Ours is derived from whether retrieval returned anything above a
similarity floor, whether the tools needed for the question were available and succeeded, whether the intent
matched a known category, and whether the turn touches a sensitive area. High confidence answers; medium
answers with hedging; low hands off to a human.

Tools are the only way the agent reaches data. Each has a Zod schema, a required permission, an implicit
workspace scope taken from the context rather than from the model's arguments, and an audit entry when it
mutates. `create_order` re-derives every price from the database and recomputes the total server-side; a total
proposed by a model is treated as untrusted input and discarded. The agent has no SQL access of any kind.

---

## 10. Knowledge base and retrieval

A knowledge source is text, a FAQ pair, an uploaded PDF or DOCX, a URL, or the product catalogue. Ingestion
runs as a background job: extract text, chunk it with overlap on semantic boundaries, embed each chunk, and
store it with its `workspaceId` and source reference. Documents are validated on upload for MIME type,
extension, and size, stored privately, and never executed.

Retrieval is a vector similarity search with a `workspaceId` filter and a minimum similarity threshold. The
threshold matters more than the ranking: without a floor, the nearest chunk is always returned even when it is
irrelevant, and the agent then answers a question about shipping using the returns policy. Below the floor,
retrieval returns nothing and the grounding layer takes over.

---

## 11. Orders, money, and inventory

Money is stored as integer minor units with an explicit currency. Floating point never touches a price. Order
lines snapshot the unit price at the time of ordering, because a later price change must not retroactively
rewrite an existing order's total.

Totals are computed server-side, always, from database prices: line subtotals, then order subtotal, then
delivery, then tax, then discount, then total. A client-supplied or model-supplied total is rejected rather
than trusted. The reference case from the brief — two units at Rs. 3,499 plus Rs. 250 delivery equalling
Rs. 7,248 — exists as a unit test.

Inventory tracks available, reserved, and sold quantities. Order creation reserves stock inside the same
transaction that writes the order, using row-level locking, so two concurrent orders cannot both reserve the
last unit. Available stock can never go negative; the attempt throws a domain error that the agent surfaces as
"that size is out of stock" rather than silently overselling.

---

## 12. Automation engine & notification system

Automations are data, not code: an `Automation` owns a trigger (`TriggerType` and optional `triggerConfig`) and an ordered list of `AutomationAction` rows.

### Triggers & Evaluation
Triggers are domain events emitted during webhook processing, database mutations, or periodic scans:
- `MESSAGE_RECEIVED` & `MESSAGE_CONTAINS`: Evaluates inbound messages against keyword lists with configurable `matchMode` (`ANY`, `ALL`, `EXACT`) and case-sensitivity.
- `ORDER_STATUS_CHANGED` & `LEAD_STAGE_CHANGED`: Evaluates transition state pairs (`fromStatus`/`toStatus`, `fromStage`/`toStage`).
- `LOW_STOCK`: Triggers when inventory falls at or below a configured threshold.
- `CONVERSATION_IDLE`: Triggered by `scanIdleConversations` / `automation.check_idle` background scanner when customer conversations remain inactive beyond a configured threshold (e.g. 60 minutes).
- `HANDOFF_REQUESTED`: Triggered when human takeover or AI escalation occurs.

### Execution & Resumption
- **Sequential Execution**: Actions are sorted by `position`. When a direct action runs (`SEND_MESSAGE`, `ADD_TAG`, `ASSIGN_CONVERSATION`, `SET_LEAD_STAGE`, `PAUSE_AI`, `RESUME_AI`, `NOTIFY_TEAM`, etc.), execution updates `AutomationRun.currentActionPosition` and advances immediately.
- **WAIT / Delayed Resumption**: When a `WAIT` action is encountered, the run transitions to `status = 'WAITING'`, advances position to `action.position + 1`, and enqueues a delayed background job (`automation.resume`) with `runAt = now + duration`. The worker resumes execution at `resumePosition` without re-executing earlier actions.
- **Deduplication & Idempotency**: Runs carry a deterministic dedupe key `auto:<automationId>:<subjectType>:<subjectId>:<eventKey>` backed by a database unique constraint. Retries or duplicated trigger events reuse existing runs without duplicate message dispatches or state mutations.
- **AI Safety & Handoff Coordination**: Automations invoking `PAUSE_AI` atomically toggle `conversation.aiEnabled = false` with timestamps and handoff reasons. The AI runtime checks `aiEnabled` at the start of every turn and suppresses automated turns when human control is active.

### In-App Notification Center
Notifications (`Notification` model) are scoped to `workspaceId` and optional `memberId`. In-app notification bell UI displays live unread counts, grouped notification items, and provides server actions (`markNotificationRead`, `markAllNotificationsRead`). Asynchronous notification delivery is fulfilled via `notification.deliver` background jobs.

---

## 13. Background jobs & worker runtime

Jobs live in PostgreSQL. The worker claims work with `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, which gives correct competition between multiple workers without a broker. Each job has a type, a payload, an attempt count, a `runAfter` timestamp, and exponential backoff with a dead-letter state after a bounded number of failures.

### Registered Handlers
All handlers are explicitly registered in `server/jobs/handlers/index.ts`:
- `maintenance.sweep`: Periodic database cleanup and expired session purging.
- `whatsapp.process_webhook`: Ingests, verifies, and routes incoming WhatsApp messages and status callbacks.
- `whatsapp.send_message`: Asynchronous outbound WhatsApp message dispatching via `dispatchOutboundMessage`.
- `ai.respond`: Orchestrates AI agent turns, RAG retrieval, tool execution, and grounded replies.
- `automation.run`: Asynchronous background automation execution.
- `automation.resume`: Resumes delayed wait-then-act automation workflows at exact action indices.
- `automation.check_idle`: Scans for idle customer conversations and triggers follow-up automations.
- `notification.deliver`: Asynchronous delivery and dispatching of in-app and channel notifications.

Redis is not a hard dependency. At the volumes this product will see for a long time, a Postgres queue is both sufficient and one fewer thing to operate, back up, and pay for. `JobQueue` is an interface, so a Redis or managed driver can replace the default without touching a handler.

---

## 14. Usage metering and cost control

Every AI call writes a `UsageRecord` attributed to workspace, agent, conversation, message, provider, and
model, with input and output token counts and a computed cost from a model price table in configuration. Every
outbound WhatsApp message, automation execution, and stored byte is metered the same way.

This is not a reporting nicety — it is the difference between a profitable SaaS and an expensive hobby. Cost
control comes from bounded context assembly, a hard output-token cap, cheaper models routed to classification
and summarisation while capable models handle customer-facing generation, per-workspace and per-user rate
limits, and plan limits that degrade gracefully rather than deleting anything.

---

## 15. Plans and billing

Plans are configuration, not scattered conditionals. `config/plans.ts` declares each plan's price, limits, and
feature entitlements, and every enforcement point reads from it. Nothing in the codebase hard-codes a price or
a numeric limit.

Subscriptions move through `TRIAL`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `EXPIRED`. Exceeding a limit restricts
new activity — no new AI replies, no new outbound sends — while leaving all existing data readable and
exportable. Deleting a paying-then-lapsed customer's data is both hostile and a good way to be sued.

---

## 16. Frontend architecture

Server Components are the default and fetch through services with a `TenantContext`. Client Components are used
only where interaction requires them, which keeps tenant-scoped data access on the server by default rather
than by discipline.

The design system lives in `components/ui` and is owned in-repo. Every list view has a loading skeleton, a
populated state, an empty state with a concrete next action, and an error state. Blank screens are treated as
bugs.

The inbox is three columns on desktop — conversation list, thread, customer panel — collapsing to a stacked
navigation on mobile with the thread as the primary view. Messages page by cursor, not offset, because offset
pagination on an append-heavy table shifts rows under the reader.

Accessibility is semantic HTML first, then keyboard operability, visible focus, labelled controls, and
sufficient contrast. It is part of the definition of done for a component, not a later pass.

---

## 17. Security posture

Layered, and enumerated in full in `SECURITY.md`. In brief: sessions as described in `PROJECT_PLAN.md` §4;
authorization in the service layer; three-layer tenant isolation; Zod validation at every boundary; rate limits
on authentication, AI, uploads, sending, and public endpoints; HMAC verification on webhooks; parameterised
queries via Prisma; secrets server-side only and never in client bundles; strict security headers and CSP;
private storage with signed URLs and validated uploads; and audit logging of every sensitive action.

The rule about secrets is worth stating plainly because the framework makes it easy to get wrong: environment
access is centralised in `config/env.ts`, which parses and validates on boot and exposes server-only values
through a module that client code cannot import. A missing or malformed variable fails the process at startup
rather than at the first request that needs it.

---

## 18. Observability

Structured JSON logs with a request id threaded through every layer, so one customer complaint maps to one
traceable request. Errors, performance, webhook health, AI failures, and queue depth each have an interface
with a console implementation, so an external monitoring vendor becomes a configuration change rather than a
code change. Health endpoints report database, queue, and provider reachability.

---

## 19. Extension seams

Where the product is going, and what is reserved for it today. A second channel plugs into a `ChannelProvider`
interface — not yet written, since it arrives with the second channel — but the *data* seam already exists:
`Conversation.channel` is a `Channel` enum carrying `WHATSAPP`, `INSTAGRAM`, `MESSENGER`, `WEBCHAT`, `SMS` and
`EMAIL`, so the conversation model does not assume WhatsApp. Multiple AI employees per workspace work because
`AIAgent` is already a collection with a per-conversation assignment rather than a singleton on the workspace.
Voice arrives as a transcription step in front of the existing text pipeline. A different vendor for any external
concern is a new file in a `providers/` directory. Platform administration is a separate route group with its own
authorization, kept strictly out of the workspace surface.
