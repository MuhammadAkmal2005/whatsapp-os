# Security

This product holds other businesses' customer lists, order histories and WhatsApp credentials. A tenant leak is
not a bug to fix next sprint; it is the end of the business. This document describes the controls, why each one
exists, and the tests that prove they work.

Security decisions here follow one rule: **prefer a control that cannot be forgotten over a control that must be
remembered.** A rule enforced by the type system, a lint error, a schema constraint or a `NotFoundError` thrown
inside a shared helper survives a tired developer at 2am. A rule written in a document does not.

---

## Threat model

Who we are defending against, in rough order of likelihood:

**A legitimate customer probing another tenant's data.** The most likely real attack: a signed-in shop owner
changes an id in a URL and sees whose order comes back. Every one of the three isolation layers exists for this.

**An attacker with stolen session credentials.** Mitigated by session expiry, rotation on privilege change, and
audit logging that makes the abuse visible after the fact.

**A malicious or compromised team member inside a workspace.** Mitigated by role permissions, the rank rules,
and audit logging. An AGENT should not be able to change billing or reach another workspace.

**Someone forging WhatsApp webhooks** to inject fake customer messages or fake payment confirmations. Mitigated
by HMAC verification over the raw body before parsing.

**Someone burning our AI budget.** Rate limits, per-workspace usage metering, capped output tokens, and plan
limits. An unmetered AI endpoint is a way for a stranger to spend our money.

**Prompt injection through customer messages.** A customer message is untrusted input that reaches a language
model. The model can call tools, so the tools — not the prompt — are where the boundary lives.

Explicitly out of scope for the MVP: a hostile hosting provider, physical access, and side-channel attacks
against the database.

---

## Tenant isolation

Three deliberately redundant layers. Any one is probably sufficient; the point is that one mistake does not leak
a customer list.

### 1. The request context

Every request touching tenant data resolves a `TenantContext` (`server/tenancy/context.ts`) before anything
else. Membership is verified against the database on that request, so the `workspaceId` it carries is one the
caller demonstrably belongs to.

**`workspaceId` comes from the `TenantContext` and nowhere else.** Not from a request body, a query string, a
header, or a model's tool arguments. The entire attack is "send someone else's id and see what comes back", so
an id that arrived from outside is never a way to *choose* a workspace. `assertWorkspaceMatches` exists for the
one legitimate case — confirming a client-supplied id equals the one the session already proved.

If you are passing a workspace id into a function as a parameter sourced from user input, that is the bug.

### 2. Scoped repositories

Repositories are the only layer allowed to build a Prisma `where` clause, and they inject `workspaceId`
themselves rather than accepting it as an argument a caller might forget.

This is enforced by lint, not convention. `.eslintrc.json` restricts importing `prisma` or `PrismaClient`:

> Routes, server actions and components must not import the Prisma client. Go through a repository; a service or
> the tenancy resolver may hold the client only to open a transaction or resolve request context.

The exemption list is narrow — `server/repositories`, `server/services`, `server/jobs`, `server/tenancy`, `db`,
`prisma`, `tests`. A route or component that tries to query directly fails `npm run lint`.

### 3. The post-read assertion

`assertBelongsToWorkspace(row, context.workspaceId, 'Order')` re-checks the row that actually came back. It
catches the case the first two layers cannot: a query someone wrote without the scope.

**It throws `NotFoundError`, never `ForbiddenError`.** This is not a detail. A 403 on someone else's record
confirms the id is real, and an attacker who can distinguish 403 from 404 can walk the id space and count a
competitor's orders. From outside, "not yours" and "does not exist" must be indistinguishable.

`assertAllBelongToWorkspace` is the array form, and it throws rather than filtering. Silently dropping a foreign
row would hide the bug that produced it.

### Planned: row-level security

PostgreSQL RLS is planned for Phase 9. It would make isolation a property of the database rather than of the
application, but it needs a connection wrapper that sets a session variable per request, and that is easier to
add once the query surface has stopped moving. Until then, isolation is an application guarantee — which is why
it is tested rather than assumed.

---

## Authentication

Passwords are hashed with scrypt (`server/auth/password.ts`), parameters from `PASSWORD_SCRYPT_COST`,
`PASSWORD_SCRYPT_BLOCK_SIZE` and `PASSWORD_SCRYPT_PARALLELISM`. Defaults of N=2^16, r=8, p=1 cost roughly 64 MB
and ~100 ms per hash. Each stored hash carries the parameters it was created with, so the cost can be raised as
hardware improves without invalidating existing passwords.

Verification is constant-time. Sign-in does not reveal whether an email exists — a wrong password and an unknown
address produce the same response and take comparable time, because a different answer is a user-enumeration
oracle.

Sessions are opaque random tokens, not signed claims (`server/auth/session-token.ts`). The stored value is a
hash of the token, so a database dump does not yield usable sessions. Revocation is therefore immediate and
real, which a self-contained JWT cannot offer.

Cookies (`server/auth/cookies.ts`) are `httpOnly`, `sameSite=lax`, `secure` outside development, and host-scoped.
`httpOnly` means an XSS bug cannot read the session; `sameSite=lax` is the primary CSRF control for server
actions.

Sessions last `SESSION_DURATION_DAYS` (default 30) and slide forward on use.

> **Gap.** `revokeAllSessions(userId)` exists in `server/services/auth/session.service.ts` but has no caller yet:
> there is no password-change flow, and a role change does not currently revoke the affected member's sessions.
> So a demotion takes effect on the member's *next* context resolution rather than instantly — acceptable now
> because the context re-reads the role from the database on every request, but it must become a real revocation
> before password change ships. Tracked in `docs/ROADMAP.md`.

---

## Authorization

Two independent halves, and both must run.

**Permissions** answer *what a role can do*. `server/authz/permissions.ts` holds `resource:action` strings mapped
to the five roles: OWNER, ADMIN, MANAGER, AGENT, VIEWER. `requirePermission(context, 'product:update')` sits at
the top of every mutating service method.

**Rank** answers *who may act on whom*. `outranks(actor, target)` is the single primitive. It is used by
`canAssignRole`, `canRemoveMember` and `canChangeRole`.

Enforcement is in the **service layer**, server-side. Not in the route, not in the component. A service reachable
from a server action, an API route and a background job must enforce the rule once, in the place all three pass
through. Hiding a button is a UX affordance; if a service checks in one entry point and not another, the product
is unprotected.

### Authorization primitives fail closed

`roleHasPermission` and `permissionsForRole` return `false` and `[]` for a role absent from the table, rather
than throwing. TypeScript says an unknown role cannot happen, but the value originates in a database column, and
a role added to the Prisma enum before the permission table is updated would otherwise throw *from inside an
authorization check* — turning a clean denial into a 500 on every request that user makes. Denying is both safer
and more debuggable.

### A real bypass, and what it taught us

During Phase 1 a two-step privilege escalation existed and was fixed. `canRemoveMember` stopped an ADMIN
removing a peer ADMIN, but `canChangeRole` checked only the *destination* role — never the role the target
currently held. So an ADMIN could demote a peer to MANAGER and remove them on the second click, achieving what
one click was explicitly forbidden.

The cause was duplicated logic: three inline copies of the same rank comparison, and a fourth site that needed
one and did not have it. The fix was to extract `outranks` as the single primitive rather than patch the one
branch.

It was found by a test that cross-checked `capabilitiesFor` — the function the UI renders controls from —
against the rules the mutations enforce, for *every* actor/target pairing. None of the 44 existing hand-written
rule tests had caught it. Two lessons, both now standing rules:

- When adding a rule about who may act on whom, use `outranks`. Never recompute ranks inline.
- Where the UI mirrors a server-side decision, test the agreement exhaustively across every input pairing rather
  than asserting a handful of expected booleans.

---

## Input validation

Every server-side input is validated by a Zod schema in `server/validation`. The same schema backs the
corresponding form, so client and server cannot disagree about what is valid.

Validation happens at the boundary — in the route or server action, before delegating to a service. A service
receives typed, validated data and does not re-parse it.

Where a Zod enum must be a literal tuple, it is pinned to the canonical list with a bidirectional compile-time
check, so the set the schema accepts and the set the rules consider cannot drift apart silently. Note that a type
assertion here would defeat the purpose: casting away a mismatch is not detecting it.

---

## Money

**Money is integer minor units with an explicit currency.** No floats, anywhere. `lib/money.ts` holds the
arithmetic and `server/domain/order-totals.ts` the order maths.

**All totals are computed server-side from database prices.** A total arriving from a client or proposed by a
language model is untrusted input and is discarded, not verified. `create_order` re-derives every price from the
database and recomputes the total.

Rs. 3,499 × 2 + Rs. 250 delivery must equal Rs. 7,248 every time, and that is a test, not a hope.

---

## Webhooks

`POST /api/webhooks/whatsapp` follows a fixed order, and the order is the security property:

1. **Read the raw body.** Verification must run over the exact bytes Meta signed. A body that has been parsed
   and re-serialised is a different byte sequence and will not verify — which is how signature checks end up
   quietly disabled.
2. **Verify the `X-Hub-Signature-256` HMAC** against `META_APP_SECRET`, using a timing-safe comparison
   (`services/whatsapp/signature.ts`). Failure is an undifferentiated 401; the reason is logged, never returned.
3. **Only then parse.**
4. **Persist a `WebhookEvent`** keyed on the provider event id, with a unique constraint. A duplicate insert is
   the dedupe — an application-level "have I seen this?" check has a race between two concurrent deliveries, and
   a unique index does not.
5. **Return 200 for an already-seen event.** Anything else makes Meta retry forever.

`GET /api/webhooks/whatsapp` handles verification, comparing `WHATSAPP_VERIFY_TOKEN` in constant time.

Meta retries aggressively and delivers out of order. Processing must therefore be idempotent, and status
transitions monotonic — a `delivered` callback arriving after `read` must not move the message backwards.

---

## Secrets

All environment access goes through `config/env.ts`, which begins with `import 'server-only'` — a client
component importing it is a build error, not a review comment.

No `process.env` outside that file. No secret in a `NEXT_PUBLIC_` variable, ever; anything so prefixed is inlined
into JavaScript served to the browser. Stored third-party credentials — WhatsApp tokens, payment keys — are
encrypted at rest under a key derived from `AUTH_SECRET`.

`.env` is gitignored. No real key, phone number, address or national ID number is committed anywhere, including
in seed data and test fixtures.

---

## Rate limiting

`server/ratelimit/` implements a fixed-window limiter, backed by the database so limits hold across instances.
Disable it with `RATE_LIMIT_ENABLED=false` only when it is terminated at the edge instead.

Wired today:

- **Authentication** — `consumeDual` in `server/services/auth/auth.service.ts` keys on *both* the email and the
  IP. Keying on only one is a mistake in either direction: IP alone lets a distributed attacker walk one account,
  and identifier alone lets an attacker lock a victim out by deliberately exhausting their budget. Both must
  trip.
- **Team invitations** — keyed per workspace in `server/actions/member.actions.ts`, so one workspace cannot use
  invite emails as a spam relay.

Limits for AI requests (per user *and* per workspace), message sending, file uploads, public API routes and
webhooks are already defined in `RATE_LIMITS` in `config/constants.ts`, and are attached as each of those
features lands. **An AI endpoint must not ship without its limit attached** — an unmetered path to a paid model
is a way for a stranger to spend our money, and the per-workspace limit matters as much as the per-user one
because the cost lands on us either way.

The window is fixed rather than sliding, because a fixed window is correct under concurrency with a single atomic
upsert, while a sliding window needs a read-modify-write that races in exactly the situation a limiter exists to
handle. The cost is boundary burst tolerance — an attacker can spend one allowance at the end of a window and
another at the start of the next. For 8 login attempts per 5 minutes, 16 in a moment followed by a five-minute
wall is still a wall.

Windows are aligned to absolute time rather than to first use, so every instance agrees on the boundary without
coordination and a restart cannot hand out a fresh allowance. An attacker who can trigger a crash would
otherwise get exactly that.

The client IP is taken from `x-real-ip` first and only then the first entry of `x-forwarded-for`, and an
implausible value yields `null` rather than a placeholder. A spoofable value shared by every attacker would merge
their buckets and lock out real users.

---

## Error handling

Errors are typed. `server/errors/` holds an `AppError` hierarchy, each carrying a stable machine code, an HTTP
status and a user-safe message.

A response never contains a stack trace, a SQL fragment, an internal path or a provider error verbatim. The user
sees something they can act on; the detail goes to the log with a request id that correlates the two. When a
customer reports a problem, the request id is what makes it findable.

`NotFoundError` is the response for an existent record in another tenant — see above for why this matters more
than it looks.

---

## Audit logging

Sensitive actions are recorded via `server/repositories/audit.repository.ts`: actor, action, resource, timestamp,
IP where available, and metadata. Sign-in, permission and role changes, WhatsApp connection, AI instruction
changes, price changes, order and refund actions, member add and remove, subscription changes.

Audit entries are append-only and are not deletable through the application. A log an admin can edit is not
evidence.

---

## File uploads

MIME type, extension and size are validated, with size capped by `STORAGE_MAX_UPLOAD_BYTES` (20 MB default).
Files are stored privately and served through signed URLs expiring after `STORAGE_SIGNED_URL_TTL` (15 minutes
default). Uploaded content is never executed and never served from a path where the host might interpret it.
Document ingestion happens in a background job, so a malformed file cannot hang a request.

---

## AI-specific controls

The customer's message is untrusted input reaching a model that can call tools. So the boundary is the tools, not
the prompt — prompt instructions are a suggestion to a text predictor, while a tool schema is a gate.

**The AI has no database access.** Tools only. Each tool has a Zod schema, a required permission, a workspace
scope taken from the `TenantContext` rather than from the model's arguments, input validation, and an audit entry
when it mutates.

**The AI never states a fact it did not retrieve or receive from a tool.** Prices, stock, delivery times,
policies, discounts, order status and payment confirmations come from tools or knowledge chunks. Where the
support is absent, it says so and hands off. This is tested, not trusted — see `docs/AI.md`.

**Confidence is computed from evidence**, never read from the model's claim about itself. A model's self-reported
confidence is a fluent guess.

High-risk actions require human confirmation. The model proposes; the server decides.

---

## Acceptance tests

These are mandatory and must pass before a release.

**Cross-tenant denial.** Create Workspace A and Workspace B. Create a customer, an order and a conversation in
A. Attempt to read and to mutate each of them while authenticated in B. Every attempt must fail, and must fail
with 404 rather than 403.

**Role authorization.** An AGENT must not be able to modify a subscription, add or remove an owner, reach another
workspace, or change platform settings. Verified server-side, by calling the service directly — not by checking
that a button is hidden.

**Rank rules.** An ADMIN cannot remove, demote or otherwise act on a peer ADMIN or on the OWNER, by any route
including a two-step one. The exhaustive every-pairing test in `tests/unit/member-rules.test.ts` covers this.

**Webhook idempotency.** Deliver the identical webhook twice. Exactly one message, one order and one event may
exist afterwards.

**Order totals.** Rs. 3,499 × 2 plus Rs. 250 delivery equals Rs. 7,248, computed server-side, with a
client-supplied total ignored.

**AI grounding.** With Black Kurta at Rs. 3,499 and stock 5, "Black kurta XL available?" answers from the data.
Set stock to 0 and it must not say available. With no return policy stored, "What is your return policy?" must
not produce one.

Current coverage lives in `tests/unit/tenant-isolation.test.ts`, `tests/unit/permissions.test.ts`,
`tests/unit/member-rules.test.ts`, `tests/unit/webhook-signature.test.ts`, `tests/unit/order-totals.test.ts`,
`tests/unit/session-token.test.ts`, `tests/unit/password.test.ts`, `tests/unit/rate-limit.test.ts` and
`tests/unit/invite-token.test.ts`. The full cross-tenant integration suite needs a live database and lands with
the features it protects, in Phases 2 and 3.

---

## Reporting a vulnerability

Not yet defined — this product is pre-launch and has no external users. Before it does, a security contact
address and a disclosure policy need to exist. Tracked in `docs/ROADMAP.md`.
