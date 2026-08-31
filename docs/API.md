# API

Two entry points into the same business logic, and the split is deliberate.

**Server actions** (`server/actions/`) handle everything the dashboard does. They are typed end-to-end, need no
client-side fetch code, and are the default for UI work.

**Route handlers** (`app/api/`) exist for callers that are not our own UI: WhatsApp webhooks, payment webhooks,
and eventually a public API for customer integrations.

Both are **thin adapters**. They authenticate, validate, delegate to a service, and shape the response. Business
rules and authorization live in `server/services` so that an action, a route and a background job all enforce the
identical rule. When the same rule is written twice it drifts, and the wrong copy is the one in production.

> **Active API & Actions Status.** `app/api/webhooks/whatsapp` is active (`GET` verification handshake & `POST` HMAC-signed ingestion). Health and observability routes are active at `/api/health`, `/api/health/liveness`, `/api/health/readiness`, and `/api/metrics` (Prometheus/JSON format). Server actions in `server/actions/` cover authentication, workspaces, members, contacts, products, orders, WhatsApp account connection, automations, notifications, analytics, audit log exports (`audit.actions.ts`), and human handoff.

---

## The envelope

Every route handler returns one of two shapes, so a client never has to guess whether a 200 body is data or a
problem description (`lib/api-response.ts`):

```json
{ "success": true, "data": { } }
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "details": { "email": ["Enter a valid email address."] },
    "requestId": "req_01HQZX3M4K"
  }
}
```

`code` is a stable machine string that clients may branch on. `message` is safe to show a user verbatim.
`details` carries field-level validation problems keyed by dotted path, and never free-form internal text.
`requestId` correlates a user-visible failure with the server log — when a customer reports a problem, this is
what makes it findable.

**Internal detail never appears in either field.** No stack trace, no SQL fragment, no provider payload, no
internal path. That goes to the structured log against the request id.

Construct these with `ok(data)` and `fail(code, message, options)` rather than by hand, so the shape cannot drift
between endpoints.

---

## Error codes

Every error is an `AppError` subclass (`server/errors/`) carrying a stable code, an HTTP status and a user-safe
message. Throw one from a service; the boundary translates it.

| Code | Status | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Input failed its Zod schema. Carries `details`. |
| `UNAUTHENTICATED` | 401 | No valid session. |
| `FORBIDDEN` | 403 | Authenticated, but the role lacks the permission. |
| `NOT_FOUND` | 404 | No such record — **or a record in another tenant.** |
| `CONFLICT` | 409 | Violates a uniqueness or state constraint. |
| `BUSINESS_RULE_VIOLATION` | 400 | Rejected by a domain rule, e.g. removing the last owner. |
| `RATE_LIMITED` | 429 | Limit exceeded. Sends `Retry-After`. |
| `PLAN_LIMIT_EXCEEDED` | 402 | Over a plan limit. 402 rather than 403 because the remedy is upgrading. |
| `NOT_CONFIGURED` | 409 | The feature needs setup first, e.g. sending before WhatsApp is connected. |
| `PROVIDER_ERROR` | 502 | An external service failed. Detail is logged, not returned. |
| `INTERNAL_ERROR` | 500 | Anything unexpected. Message is always generic. |

**404 for another tenant's record is a security decision, not a convenience.** A 403 confirms the id exists, and
an attacker who can distinguish 403 from 404 can walk the id space and count a competitor's orders. From outside,
"not yours" and "does not exist" must be indistinguishable. `assertBelongsToWorkspace` throws `NotFoundError` for
exactly this reason.

`PLAN_LIMIT_EXCEEDED` returning 402 lets the UI respond with an upgrade prompt rather than an error, because
hitting a plan ceiling is a sales moment and not a fault.

An unrecognised error becomes `INTERNAL_ERROR` with a generic message. Anything else risks leaking a provider's
error text, which routinely contains keys and internal hostnames.

---

## Server actions

Actions return a `FormState` (`lib/form-state.ts`) rather than the API envelope, because a form needs
field-level errors positioned under inputs:

```ts
export type FormState = {
  status: 'idle' | 'error' | 'success';
  message?: string;              // one sentence for the top of the form
  fieldErrors?: FieldErrors;     // keyed by input name
  requestId?: string;
};
```

This type is client-safe on purpose — form components import it, so it must not pull in anything `server-only`.

A successful action usually redirects rather than returning `success`, but the state exists for the cases that
stay on the page.

Every action follows the same order, and the order is the security property:

1. Resolve context — `requireTenantContext()` or `requireUserContext()`. Never trust a workspace id from the
   payload.
2. Rate-limit where the action is abusable.
3. Validate with a Zod schema from `server/validation/`.
4. Delegate to a service, which performs the authorization check.
5. Catch `AppError` and map it to `FormState`; revalidate affected paths.

`server/actions/action-helpers.ts` holds the shared wrapper so this cannot be assembled differently each time.
Existing actions: `auth.actions.ts`, `workspace.actions.ts`, `member.actions.ts`, `contact.actions.ts`, `product.actions.ts`, `order.actions.ts`, `whatsapp-account.actions.ts`, `automation.actions.ts`, `notification.actions.ts`, `handoff.actions.ts`.

---

## Pagination

**Offset pagination** for stable lists — products, orders, contacts — where a page number is meaningful:

```json
{ "items": [], "page": 1, "pageSize": 25, "total": 137, "totalPages": 6, "hasMore": true }
```

**Cursor pagination** for append-heavy lists — messages and conversations:

```json
{ "items": [], "nextCursor": "01HQ...", "hasMore": true }
```

Offset pagination is wrong for a thread. New messages arrive at one end while the reader pages through it, so
page two shifts under them and rows are duplicated or skipped. A cursor is anchored to a row and cannot drift.

The cursor implementation fetches `limit + 1` rows and does not return the extra one; its existence is the proof
that a further page exists, which avoids a second count query.

Never return an unbounded list. `DEFAULT_PAGE_SIZE` (25), `MAX_PAGE_SIZE` (100) and `MESSAGE_PAGE_SIZE` (40) live
in `config/constants.ts`, and a client-supplied page size is clamped to `MAX_PAGE_SIZE` — an unclamped
`pageSize=1000000` is a denial-of-service vector wearing a query parameter.

---

## Webhooks

### `GET /api/webhooks/whatsapp`

Meta's verification handshake. Compares `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN` in constant time and
echoes `hub.challenge`. Returns 403 on mismatch.

### `POST /api/webhooks/whatsapp`

Inbound messages and status callbacks. The processing order is fixed:

1. **Read the raw body.** Verification must run over the exact bytes Meta signed — a body that has been parsed
   and re-serialised is a different byte sequence and will not verify.
2. **Verify the `X-Hub-Signature-256` HMAC** against `META_APP_SECRET` with a timing-safe comparison
   (`services/whatsapp/signature.ts`). Reject with an undifferentiated **401** on failure. The module distinguishes
   `missing`, `malformed` and `mismatch` for the server log, but the response must not — telling a caller *why*
   their forgery failed is free help for the next attempt.
3. **Parse.**
4. **Insert a `WebhookEvent`** on the provider event id. The unique constraint *is* the deduplication — a
   replayed delivery conflicts and is answered 200 immediately. An application-level "have I seen this?" check
   races between two concurrent deliveries; a unique index does not.
5. **Enqueue processing** and return 200 quickly. Meta retries on timeout, so slow synchronous work turns one
   message into several.

**Always 200 for a duplicate.** Anything else makes Meta retry forever.

**200 also for an event we cannot process**, once it is persisted. A 500 asks Meta to redeliver something that
will fail identically; recording it as failed and moving on is both more honest and more recoverable. The
`WebhookEvent` row is the retry queue.

Statuses arrive out of order. Transitions are monotonic — `sending → sent → delivered → read` — so a `delivered`
callback arriving after `read` must not move the message backwards.

---

## Public API

Planned, not built. When it lands it needs per-workspace API keys, a documented and versioned contract, its own
rate-limit tier (`publicApi` in `RATE_LIMITS` is already configured at 100 requests per minute), and scoped
permissions so a key can be read-only. Tracked in `docs/ROADMAP.md`.

---

## Adding an endpoint

Write the Zod schema in `server/validation/`. Put the rule in a service with its `requirePermission` call. Make
the route or action a thin adapter — validate, delegate, envelope. Return `ok()` or throw an `AppError`; never
build an error body by hand. Then test the happy path, the authorization denial, and the cross-tenant denial.

If a route needs a `where` clause, it is doing a repository's job. If it needs a business rule, it is doing a
service's job. Both cases mean the logic is in the wrong file, and the tell is that you cannot reuse it from a
background job.
