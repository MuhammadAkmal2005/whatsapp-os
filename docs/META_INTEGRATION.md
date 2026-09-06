# Meta WhatsApp Business Platform integration

How a business's own WhatsApp number becomes a working ConvoNexa channel, and what each part of that is
evidence of. [WHATSAPP.md](WHATSAPP.md) covers the channel itself — messages, the webhook receiver, the
24-hour window. This document covers the connection.

> **Status.** The integration is implemented and covered by automated tests against mocked Meta HTTP. It has
> **not** been verified against a live Meta-connected number, because that requires credentials on a real Meta
> app. The exact remaining steps are in [Manual Meta setup](#manual-meta-setup); until they are done and the
> live loop is observed, this integration is not production-proven. See
> [Honest gaps](#honest-gaps) for what is deliberately not implemented.

---

## The shape of it

```
Business owner
  → Embedded Signup dialog (Meta's popup, in the browser)
  → authorization code + claimed asset ids
  → server-side code exchange (app secret)              server/services/whatsapp/meta-graph.client.ts
  → asset verification against Meta                     meta-onboarding.service.ts
  → subscribe this app to the WABA, then read it back
  → register the number on Cloud API
  → encrypted token + ids on WhatsAppAccount / WhatsAppPhoneNumber

Customer message
  → Meta → POST /api/webhooks/whatsapp (HMAC over raw body)
  → phone_number_id → WhatsAppPhoneNumber → workspaceId
  → WebhookEvent (unique on provider event id) → job queue
  → AI runtime (knowledge, business brain, rules, tools, approval)
  → outbound.service.ts → MetaWhatsAppProvider → Meta → customer
```

The two halves are deliberately independent: an inbound message can arrive on a connection that cannot send,
and a connection that can send may not be receiving. `CONNECTED` means both were proven.

---

## Multi-tenancy: one app, many businesses

ConvoNexa is one Meta app. Each customer connects **their own** WhatsApp Business Account and number to it.

What lives in the environment — platform-wide, one value for the whole deployment:

| Variable | What it is |
| --- | --- |
| `META_APP_ID` | ConvoNexa's Meta app id. Public; it appears in Meta's own popup URL. |
| `META_APP_SECRET` | Signs the OAuth code exchange, verifies the webhook HMAC. Secret. |
| `META_LOGIN_CONFIG_ID` | The Facebook Login for Business configuration that defines which WhatsApp assets Embedded Signup asks for. |
| `WHATSAPP_VERIFY_TOKEN` | Echoed back during the callback-URL handshake. Shared secret. |
| `WHATSAPP_API_VERSION` | Graph version, default `v26.0`. Used by the server calls and the browser SDK alike. |
| `META_OAUTH_REDIRECT_URI` | Only for the redirect-based login flow. Codes minted by the JS SDK carry no `redirect_uri`, and sending one Meta did not issue the code against makes the exchange fail — so it is passed through only when set. |

What lives per workspace, on `WhatsAppAccount` and `WhatsAppPhoneNumber`: the WABA id, the owning Meta business
id, the phone number id, the display number, the access token (encrypted), token type and expiry, connection
method, status, and every lifecycle timestamp.

**There is no global access token, phone number id or WABA id, and there must never be one.** A single set of
customer credentials in the environment would mean every tenant sending from one number. `config/env.ts` has no
field to put one in.

---

## Onboarding

Two paths, both official, both ending in the same verification pipeline
(`establishMetaConnection`). They differ only in how the token is obtained, which is the point: a connection
made by pasting a token is exactly as trustworthy as one made through Meta's dialog, because everything after
the token is checked identically.

### Embedded Signup (the one to use)

`components/settings/whatsapp/embedded-signup-button.tsx` loads Meta's JS SDK and calls `FB.login` with
`config_id`, `response_type: 'code'` and `override_default_response_type: true`. The business signs in to Meta,
picks or creates its WABA, and verifies its number — none of which passes through ConvoNexa.

Two values come back, by two different routes, in either order: the authorization code arrives in the `FB.login`
callback, and the asset ids arrive as a `WA_EMBEDDED_SIGNUP` `postMessage`. The component holds both and submits
once it has the pair, because Meta's code lives about **thirty seconds** — too short for a queue, which is why
`completeEmbeddedSignupAction` exchanges it inline.

The `message` handler checks `event.origin`'s hostname ends with `facebook.com` before reading anything. Without
that, any page in the opener chain could post a WABA id of its choosing.

**CSRF.** `startEmbeddedSignupAction` mints an HMAC-signed state token binding the workspace id, the membership
id, a nonce and a 15-minute expiry (`meta-signup-state.ts`). The callback refuses a state issued to anyone else,
so a code obtained in one session cannot be posted into another workspace. Every failure mode returns the same
sentence: distinguishing "expired" from "forged" tells an attacker which half to work on.

### System user token (the fallback)

A business whose Meta account was set up by someone else already has a permanent System User token, and a
deployment awaiting Tech Provider approval has no `META_LOGIN_CONFIG_ID` at all. `ConnectWhatsAppForm` takes the
token plus the WABA id, phone number id and display number. The token field is `type="password"` with no default
value, because it is never read back to the browser after it is stored — an update means pasting it again.

### What is verified, and why in that order

`verifyAssets` is what makes a client-posted `phone_number_id` harmless:

1. `GET /<WABA_ID>` with the exchanged token. Proves the token grants that WABA.
2. `GET /<WABA_ID>/phone_numbers`. The claimed phone number must appear in Meta's own list.
3. Cross-tenant claim check: a WABA or number already held by another workspace is refused, without revealing
   anything about that workspace beyond the fact that the asset is taken.

The ids that survive are the ones **Meta just told us the token grants**. Nothing from the request body reaches
the database unverified, and `workspaceId` comes from the server-side tenant context, never from the payload.

`debug_token` is called too, but advisorily. Only the app that issued a token can introspect it, so a System User
token created inside a business's own app answers 403 with our app credentials — a legitimate setup, not a bad
token. A failure there degrades to a warning rather than refusing the connection.

### Subscription is per WABA

`POST /<WABA_ID>/subscribed_apps` (bearer token, no body) is what makes Meta deliver this business's events to
this deployment. It returns `{"success": true}`.

**Then we read the edge back**, and only the GET listing our app id is treated as evidence. A `success: true`
response is Meta accepting a request; a subsequent read is Meta confirming the state. The callback-URL
verification handshake described in [WHATSAPP.md](WHATSAPP.md#get-apiwebhookswhatsapp) proves neither — it proves
only that our URL answers. A connection whose subscription cannot be confirmed persists as `DEGRADED` with the
reason attached, because a business shown "messages may not arrive, here is why" can act and one shown a green
tick cannot.

### Registration

`POST /<PHONE_NUMBER_ID>/register` with `{ messaging_product: 'whatsapp', pin }` puts the number on Cloud API so
it can send. Two deliberate abstentions:

- A number Meta already reports as `platform_type: CLOUD_API` is left alone. `register` is capped at **ten calls
  per number per 72 hours** (error 133016), and spending one to learn what we were just told is how a reconnect
  locks a business out of its own number.
- A number whose code verification has not completed cannot be registered at all, so we say that instead of
  firing a call that will certainly fail.

The PIN is generated per registration and stored encrypted, because re-registration after a Meta-side reset needs
the same PIN. A number that was already registered kept its original PIN, so we store nothing rather than
recording ours as if it were the live one.

---

## Credential security

The access token is the whole business: it sends messages as them and reads their entire customer history.

**At rest.** AES-256-GCM via `encryptSecret`, keyed by scrypt from `AUTH_SECRET`, format `v1:<iv>:<tag>:<ct>`.
The same mechanism as every other stored provider secret in the codebase — no new secret system was invented for
this.

**In transit within the app.** `WhatsAppAccountRow` — the type the repository returns for read paths — has no
token field, so the DTO the settings page renders has nothing to accidentally carry one. The encrypted blob is
selected only where it is about to be decrypted for a Graph call.

**In logs and telemetry.** `MetaGraphClient.request` takes a per-call `secrets` list and redacts each value ≥8
characters from anything it logs or throws, plus a belt-and-braces `/EAA[A-Za-z0-9_-]{20,}/g` pattern for tokens
that were never passed in. `MetaTelemetryProps` types `accessToken`, `token`, `code`, `pin`, `appSecret` and
their snake_case variants as `never`, so `properties: { accessToken }` is a compile error rather than something a
reviewer has to catch.

**Never.** Not to the browser, not through a server action return value, not in a React prop, not in an error
message, not in `.env.example`. The Embedded Signup component handles no secret at all: the app id is public,
the state token is signed rather than secret, and the authorization code is exchanged server-side.

---

## Routing and tenant isolation

`WhatsAppPhoneNumber.phoneNumberId` is `@unique` **globally**, not per workspace. That single constraint is what
makes it impossible for one Meta phone number to resolve to two tenants — cross-tenant routing is not defended
against at the query level, it is unrepresentable in the schema.

Everything downstream takes `workspaceId` from that row. A signed webhook body is authentic, but authenticity
only tells us which phone number, not which tenant, and the payload is not the authority on that.

The AI never chooses a phone number id, WABA id, token or business id. Those are read from the resolved account
inside the outbound service; a tool's arguments cannot influence which number a message goes out on.

---

## Outbound

`dispatchOutboundMessage` takes a message row that already exists and hands it to the provider. It never creates
a message, so a retry cannot create a second thread entry.

**A retry can still cause a second *send*, and stopping that is most of what the file does.** Meta's `/messages`
endpoint accepts no idempotency key and offers no "did you already accept this?" query, so a send whose answer
was lost cannot be made safe by retrying — the duplicate lands in a real customer's WhatsApp and cannot be
recalled.

Four gates, in the order a retry hits them:

1. A provider message id is already recorded.
2. The status has already advanced past `SENDING`.
3. A re-read, for the concurrent case.
4. **`deliveryUncertainAt` is set** — a previous attempt ended without an answer from Meta.

Gate 4 is the one that matters after a timeout. A human can resend from the inbox once they have looked at the
thread; an automated retry cannot look.

### Failure classification

`send-failure.ts` maps a failure to one of three classifications, and the pair (classification, retryable) is
what determines what the queue does next:

| Classification | Meaning | Row left at |
| --- | --- | --- |
| `NOT_SENT_RETRYABLE` | Nothing reached Meta; retrying is free | `FAILED`, retryable |
| `NOT_SENT_PERMANENT` | Meta looked at the request and refused it | `FAILED`, not retryable |
| `UNCERTAIN` | The answer was lost | **`SENDING`**, never auto-retried |

`UNCERTAIN` deliberately leaves the status at `SENDING`. `FAILED` would falsely assert non-delivery and `SENT`
would falsely assert delivery; neither is a claim we can make. Anything unrecognised classifies as `UNCERTAIN`.

Both Meta adapters — `meta-graph.client.ts` for management calls and `meta-provider.ts` for messaging — attach a
shared `MetaGraphFailure` record answering "could the request bytes have reached Meta?" One `transportFailure()`
means a timeout has the same meaning on both paths.

**`requestPossiblySent` alone must never decide retryability.** The graph client sets it `false` for every HTTP
status below 500, so that reading would retry a 401 credential rejection forever. The order in `send-failure.ts`
is: auth codes (190, 10) and 401/403 first, then 5xx (uncertain), then other 4xx (permanent).

### The second double-send hole

`recordMessageDispatch` used to sit outside the try/catch, so a transient database failure *after* a successful
send left the row at `SENDING` with no provider id — indistinguishable from a send that never happened, and it
would be sent again. `persistDispatchResult` closes it with three bounded attempts, and on total failure flags
the row `UNCERTAIN` **before** rethrowing, so the queue's retry short-circuits at gate 4 instead of sending.

Account-level `ERROR` is promoted only for `META_CREDENTIALS_REJECTED`. A rejected recipient or a closed service
window is a per-message fact; flagging the whole channel for it trains the owner to ignore the banner.

### Rate limiting

`messageDispatch` is a per-workspace bucket, 600 per 60 seconds, consumed **before** the row advances to
`SENDING` so a denial leaves it `QUEUED` and defers rather than drops.

Ten per second sits far below Meta's documented default of 80 messages/second per phone number, so we are never
the reason Meta returns a 429. It is distinct from `messageSend`, which bounds how fast a *human* can compose:
the transport ceiling must stay above the composing ceiling, or the inbox would be blocked by the transport. Both
properties are asserted in `tests/unit/rate-limit.test.ts`.

Without a per-workspace bucket, one workspace's campaign can occupy every worker slot while another workspace's
customer waits for a reply.

---

## Delivery status

Meta's `sent`, `delivered`, `read` and `failed` callbacks map onto `MessageStatus`, and transitions are
**monotonic** — Meta delivers callbacks out of order, and a `delivered` arriving after `read` must not move the
message backwards. `sentAt`, `deliveredAt`, `readAt` and `failedAt` are separate columns so a late callback fills
in its own field without disturbing the current status.

`FAILED` is the one status allowed to arrive out of rank order, because a failure reported late is still a
failure the owner needs to see.

---

## Connection health

The indicator this replaces was `status === 'CONNECTED'`, which in practice meant *a row holds a token*. That is
not a health check. A token can be revoked in Business Manager, a subscription can be removed, a number can be
deregistered — **and none of those events notify us.** A green tick in any of those states is worse than no tick,
because the owner stops looking.

`meta-connection-health.service.ts` runs five named checks in increasing order of cost, and every answer is
evidence:

| Check | What it proves | Cost |
| --- | --- | --- |
| `token_present` / `token_expiry` | A token exists and has not expired by the clock we hold | free |
| `phone_number_readable` | `GET /<PHONE_NUMBER_ID>` succeeds — the token and the grant are live | one round trip |
| `webhook_subscription` | `GET /<WABA_ID>/subscribed_apps` lists our app id — Meta will deliver here | one round trip |
| `recent_activity` | Something actually flowed. The only answer that is not Meta's opinion | free |

A live verdict is cached for **five minutes**: long enough that opening the settings page repeatedly costs one
round trip, short enough that a revoked token is noticed within a coffee break. The settings page always reads
the cached path — one database read, no Graph traffic on page load — and the panel's "Check now" button forces
past the TTL, which is the action for the moment just after someone fixed something in Business Manager.

The check is **read-only towards Meta**. Nothing subscribes, registers or repairs. A check that silently fixed
things would make the panel a liar about what the state had been, and a repair is the owner's decision.

A failure yields `DEGRADED`, not `ERROR`. `ERROR` is written by the send path, which has actual evidence of Meta
refusing a real request; overwriting it from a probe would erase the more specific fact.

`recent_activity` warns rather than fails when a number is quiet. A small shop can go a day without a message,
and calling that broken would train the owner to ignore the panel.

---

## Disconnect and reconnect

Disconnecting destroys the ability to act — the token, the token metadata, the subscription timestamps, the
registration PIN — and keeps the row. Conversations, contacts, orders and messages point at it, and that history
is the business's.

**Meta is not asked to unsubscribe.** The business may be moving the number to another tool or reconnecting in a
minute, and tearing down their subscription on their behalf is a change to their Meta account they did not ask us
to make. What we control is whether *we* can still use it, and after this we cannot.

Reconnecting the same number upserts the existing account rather than creating a second one — `wabaId` and
`phoneNumberId` are unique, so a duplicate connection record is not representable. The settings page keeps
showing a disconnected card with a primary "Reconnect" button for exactly this reason: an owner who disconnected
by accident wants the same number, with the same history, back.

Both actions write an `AuditLog` entry with the actor, the assets and the timestamps.

---

## Telemetry

`server/telemetry/meta-events.ts` is the only place these event names exist, so a dashboard query cannot be
broken by a typo at a call site: `meta_connection_started`, `meta_connection_succeeded`,
`meta_connection_failed`, `meta_connection_health_failed`, `meta_webhook_received`, `meta_webhook_rejected`,
`meta_message_received`, `meta_message_sent`, `meta_message_failed`.

Each emitter increments a Prometheus counter, writes a structured log line, and — where a workspace owns the
event — appends a `ProductEvent` row so the fact survives a log rotation. Telemetry failures are caught and
logged: they must never be the reason a connection or a customer reply fails.

The webhook emitters are synchronous and log-only. They fire on Meta's delivery path, before a tenant is known,
at whatever rate Meta chooses; a database write per webhook would let a burst exhaust the connection pool.

---

## Local development

Meta requires a **public HTTPS** callback URL, so `localhost:3000` cannot receive webhooks directly. Use a tunnel:

```bash
npx localtunnel --port 3000
```

or `cloudflared tunnel --url http://localhost:3000`, or ngrok. Then in the Meta app dashboard, under
**WhatsApp → Configuration → Webhook**, set the callback URL to `https://<your-tunnel>/api/webhooks/whatsapp`
and the verify token to whatever `WHATSAPP_VERIFY_TOKEN` is set to locally. Subscribe to the `messages` field.

A tunnel URL changes each time it is started on the free tiers, and Meta re-runs the verification handshake on
every save — so expect to update it per session. Do not commit tunnel configuration.

**The offline alternative.** `MOCK_WHATSAPP=true` (the default) needs no tunnel, no Meta app and no credentials.
The mock is a real implementation of the provider interface, so it drives the same code paths; the inbound
simulator exercises routing, conversation creation, the AI reply and order creation end to end. `isMock` is
persisted and stated on the settings card, so a simulated connection can never be mistaken for a live one, and
`config/env.ts` refuses to boot a production deployment with the mock enabled.

---

## Manual Meta setup

These require a Meta account and cannot be done from code. Nothing below asks anyone to paste a secret into a
chat — each value goes into an environment variable locally or at the deployment platform.

**In the Meta App Dashboard** (developers.facebook.com):

1. Create or open a **Business** type app.
2. Add the **WhatsApp** product.
3. Note the **App ID** → set `META_APP_ID`.
4. Reveal the **App Secret** → set `META_APP_SECRET`.
5. Add the permissions `whatsapp_business_messaging` and `whatsapp_business_management`.
6. Create a **Facebook Login for Business** configuration with those WhatsApp asset permissions. Note its
   configuration id → set `META_LOGIN_CONFIG_ID`.
7. Under **WhatsApp → Configuration → Webhook**, set the callback URL to
   `https://convonexa.com/api/webhooks/whatsapp` and the verify token to the value of `WHATSAPP_VERIFY_TOKEN`.
   Save; Meta runs the GET handshake immediately.
8. Subscribe the webhook to the **`messages`** field. Without this, no inbound event or delivery status is sent.
9. Add `https://convonexa.com` to **Valid OAuth Redirect URIs** if the redirect-based flow is used; the JS SDK
   flow does not need it.
10. For Embedded Signup to be offered to businesses that are not app testers, the app needs **Tech Provider**
    verification and App Review for the two WhatsApp permissions. Until then, the manual System User token path
    is the working route.

**At the deployment platform** (convonexa.com — do not migrate hosting for this), set: `META_APP_ID`,
`META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN`, `MOCK_WHATSAPP=false`, and
`WHATSAPP_API_VERSION` only if pinning back from the default.

**To verify the live loop**, connect a real number and then confirm, in order: the GET handshake passed on save;
`meta_webhook_received` appears when a customer sends "Hello"; the message appears in the inbox; the AI replies;
the reply arrives on the customer's phone; the delivery status advances to `DELIVERED` then `READ`. The
connection health panel should show every check passing, with `webhook_subscription` confirmed by a live check
rather than a cached one.

---

## Honest gaps

**Per-WABA webhook override.** Meta supports overriding the callback URL per WABA, which would let one
deployment route different businesses to different endpoints. The current parameter names for that could not be
confirmed against Meta's live documentation, so it is **not implemented** rather than guessed at. The
platform-level callback URL serves every tenant, and routing is done by `phone_number_id` after delivery — which
is correct and sufficient for a single deployment.

**Live verification.** Every path is tested against mocked Meta HTTP. None has been exercised against a real
Meta-connected number. The tests prove the code does what it intends against the request and response shapes
documented; they cannot prove those shapes match what Meta sends today.

**Media download.** Inbound media is recorded but the download-and-store job is deferred, so a Meta-hosted URL
can expire before the file is ours.

**Token refresh.** Business integration system user tokens from Embedded Signup carry an expiry when Meta
reports one; the health check warns within seven days of it. There is no automatic refresh — the owner
reconnects. Automating it would mean holding a refresh path we cannot test without a live app.
