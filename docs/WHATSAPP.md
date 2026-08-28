# WhatsApp integration

WhatsApp is the first channel and, for the MVP, the only one. The architecture treats it as *a* channel rather
than *the* channel, so Instagram, Messenger, web chat and SMS can be added later without rewriting the inbox.

> **Implementation Status.** Phase 4 Units 1–3 are built and committed (`75360a5`): `MetaWhatsAppProvider`, HMAC webhook verification (`/api/webhooks/whatsapp`), logical event parser (`webhook.parser.ts`), and async background job processor (`whatsapp.process_webhook`). Phase 4 Unit 4 (WhatsApp Account Connection & Management UI) is implemented and verified locally (uncommitted). Unit 5 (Final Integration / Acceptance Suite) is next. Media download/storage is deferred.

---

## Compliance comes first

**We use the official WhatsApp Business Platform (Cloud API) and nothing else.** No web scraping, no QR-code
session hijacking, no browser automation impersonating a client, no unofficial library that logs in as a user.

This is not a style preference. Unofficial automation gets the *business's* number banned, not ours — we would be
selling a product whose main effect is destroying the customer's primary sales channel. And it would end this
company. Anyone proposing a shortcut here should be understood as proposing to close the business.

The same reasoning governs messaging behaviour. No unsolicited bulk messaging. Campaigns respect the 24-hour
customer service window and use approved templates outside it. Opt-out is honoured. A platform that gets a
reputation for spam loses its API access, and every tenant on it loses their number.

---

## Never invent the API

Meta's Graph API is versioned and changes. `WHATSAPP_API_VERSION` pins it, currently `v21.0`.

**If the current documentation for an endpoint cannot be read, write the interface and a mock implementation and
stop.** A plausible-looking endpoint that does not exist is worse than an honest gap: the gap gets filled, while
the invention passes review, ships, and fails against the real service in front of a customer.

This applies to request shapes, field names, error codes and status semantics equally.

---

## Provider abstraction

`WhatsAppProvider` is an interface. Two implementations: the Cloud API, and a mock.

```
sendText            sendMedia           sendTemplate
markRead            uploadMedia         downloadMedia
verifyWebhook       parseWebhookEvent
```

Nothing outside `services/whatsapp/` knows Meta's payload shapes. The adapter speaks Meta's language inbound and
returns normalised domain shapes outbound, which is what keeps a second channel from becoming a rewrite.

### Mock mode

`MOCK_WHATSAPP=true` is the default. No real message is ever sent: outbound sends are recorded and displayed, and
an inbound simulator injects customer messages so the whole pipeline — routing, conversation creation, AI reply,
order creation — can be exercised offline.

The mock is a real implementation of the interface, not a stub. It has to drive the same code paths, or those
paths are only ever tested against a service that costs money and needs a verified business.

Two safeguards make mock mode honest rather than confusing:

`config/env.ts` **refuses to boot with `NODE_ENV=production` and `MOCK_WHATSAPP=true`.** The dangerous failure is a
live deployment answering real customers from a mock while everyone believes it is connected, so it is made
impossible rather than warned about.

`WhatsAppAccount.isMock` is persisted, so the UI states plainly that this is a simulated connection instead of
implying a live one. A shop owner must never be unsure whether their customers are actually receiving replies.

---

## Connecting an account

`WhatsAppAccount` holds the Meta WhatsApp Business Account id, a display name, a `ChannelStatus` of
`DISCONNECTED | PENDING | CONNECTED | ERROR`, the `isMock` flag, and `accessTokenEncrypted`.

**The access token is encrypted at rest** under a key derived from `AUTH_SECRET`, and is never returned to the
browser under any circumstance — not masked, not partially, not to an OWNER. A leaked token lets an attacker send
messages as the business and read their entire customer history. It is written by the connect flow and read only
by the server-side provider adapter.

`lastErrorAt` and `lastErrorMessage` exist so a broken connection is visible in the UI as a state with a reason,
rather than as messages that quietly stop arriving. Silent failure is the worst outcome here: the business
believes it is talking to customers.

The owner-facing language is "Connect WhatsApp", never "configure webhook". The person doing this runs a clothing
shop.

---

## Routing: how a webhook becomes a workspace

`WhatsAppPhoneNumber` is the inbound routing table, and it is the security-critical hinge of the whole
integration.

A webhook arrives carrying a `phone_number_id`. `phoneNumberId` is globally unique in our schema, which makes
routing a single indexed lookup and — more importantly — makes it impossible for one Meta phone number to map to
two workspaces. That uniqueness is what stops one business's customer messages from landing in another's inbox.

Everything downstream derives its `workspaceId` from that row. **Never from anything in the payload.** A webhook
body is attacker-controllable input; a signed body from Meta is authentic but still only tells us which phone
number, not which tenant.

An unrecognised `phone_number_id` is recorded as a `WebhookEvent` with status `IGNORED` and no workspace, and
answered 200. It is not an error — it is usually a number that was disconnected, or a stale subscription — and
retrying it forever helps nobody.

---

## Webhooks

### `GET /api/webhooks/whatsapp`

The one-time subscription handshake. Meta sends `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`; we
echo the challenge only if the token matches `WHATSAPP_VERIFY_TOKEN`, compared in **constant time** because the
verify token is a shared secret and a variable-time compare leaks it one character at a time. Mismatch returns
403. `verifySubscription` implements this.

### `POST /api/webhooks/whatsapp`

Inbound messages and status callbacks. The order is fixed and each step depends on the one before:

**1. Read the raw body.** The digest must be computed over the exact bytes received. `JSON.parse` followed by
`JSON.stringify` reorders keys, changes whitespace and re-encodes non-ASCII escapes, all of which change the
digest — and Urdu product names make that failure routine rather than theoretical. Frameworks that helpfully
parse the body first are the usual reason signature checks end up quietly disabled.

**2. Verify `X-Hub-Signature-256`** against `META_APP_SECRET` with `timingSafeEqual`. Without this, the endpoint is
an unauthenticated write API: anyone who learns the URL could inject messages into a business's inbox, fabricate
delivery receipts, or drive AI spend. Failure returns an **undifferentiated 401** — `verifyWebhookSignature`
distinguishes `missing`, `malformed` and `mismatch`, but only for the log. Telling a caller why their forgery
failed is free help for the next attempt.

**3. Only then parse.**

**4. Insert a `WebhookEvent`.** `@@unique([provider, providerEventId])` **is** the deduplication. A replayed
delivery conflicts on insert and is answered 200 immediately. An application-level "have I seen this?" check has a
race between two concurrent deliveries; a unique index does not. The key is composite because two providers can
independently mint the same id string. `signatureValid` is stored on the row, so a forgery attempt is evidence
rather than a discarded request.

**5. Enqueue and return 200 fast.** Meta retries on timeout, so slow synchronous work turns one customer message
into several duplicate ones. The `WebhookEvent` row with its `status`, `attempts` and `error` is the retry queue.

**Return 200 for a duplicate**, or Meta retries forever. **Return 200 for an event we cannot process**, once it is
persisted — a 500 asks Meta to redeliver something that will fail identically, whereas a `FAILED` row can be
inspected and replayed deliberately.

---

## Messages

`MessageType`: `TEXT`, `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`, `STICKER`, `LOCATION`, `CONTACTS`, `INTERACTIVE`,
`TEMPLATE`, `REACTION`, `SYSTEM`, `UNSUPPORTED`.

`UNSUPPORTED` is deliberate. Meta adds message types, and an inbound type we do not model must appear in the inbox
as "unsupported message" so a human can look at the thread and respond. Dropping it would leave a business
answering half a conversation.

Only real API capabilities are exposed. No UI affordance for something the platform does not support.

`Message.providerMessageId` is `@unique`, which is the second idempotency mechanism: even if event-level dedupe
were bypassed, the same inbound message cannot be inserted twice.

### Status transitions are monotonic

`MessageStatus`: `QUEUED`, `SENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, plus `RECEIVED` for inbound.

Meta delivers status callbacks **out of order**. A `delivered` callback arriving after `read` must not move the
message backwards, so transitions only ever advance. The timestamps are separate columns — `sentAt`,
`deliveredAt`, `readAt`, `failedAt` — so a late callback fills in its own field without disturbing the current
status.

`occurredAt` is the provider's timestamp and `createdAt` is ours; they differ by seconds routinely, and the thread
is ordered by ours so a clock difference cannot scramble the display.

### Media

Meta hosts inbound media behind an authenticated URL that expires. Media is downloaded in a background job and
stored in our own object storage, because a link that dies in two weeks means an order dispute cannot be settled
from the payment screenshot the customer sent. `MessageAttachment` records it; files are private and served
through signed, expiring URLs.

---

## The 24-hour window

Meta permits free-form replies only within 24 hours of the customer's last message. Outside it, only an approved
template may be sent.

This is a hard platform constraint, not a policy we can soften, and it shapes real features. A follow-up
automation two days after an abandoned conversation **must** use a template. The send path checks the window and
returns `NOT_CONFIGURED` or a clear domain error rather than attempting a send that Meta will reject, because a
rejected send that surfaces as a generic failure teaches the owner nothing.

`MessageTemplate` stores name, language, `TemplateCategory` of `MARKETING | UTILITY | AUTHENTICATION`, variables
and approval status. **Templates are submitted to Meta and approved by Meta.** The UI shows the real status and
never implies a local template is usable. Pretending otherwise produces a campaign that silently sends nothing.

---

## Conversations

`ConversationStatus`: `OPEN`, `PENDING`, `RESOLVED`, `CLOSED`. A conversation always belongs to a workspace and a
contact; `phoneNumberId` is nullable, because a conversation can exist before or independently of a connected
number — a mock-mode thread, or one whose number was later disconnected — and losing the thread would be worse
than tolerating the null.

An inbound message from an unknown number creates a `Contact` and a `Conversation`, so a customer never has to be
manually added before they can be talked to. Contact identity is the phone number, scoped to the workspace.

`aiEnabled`, `aiPausedAt` and `aiPausedByMemberId` carry the human-takeover state. A paused conversation gets no
AI replies until someone resumes it, and that check is the first thing an agent turn does — see `docs/AI.md`.

`Message.sentByAi` and `aiAgentId` distinguish AI replies from human ones, which is what makes "AI handled 340,
escalated 44" reportable and lets the inbox show who said what.

---

## Acceptance tests

**Idempotency.** Deliver the identical webhook twice. Exactly one `Message`, one `WebhookEvent` and one `Order`
exist afterwards. Mandatory.

**Signature rejection.** A body with a wrong signature, a missing header, a malformed header, and a valid
signature over a *different* body must all be rejected, and none may create a message.

**Routing isolation.** A webhook for Workspace A's phone number must not create anything in Workspace B, and an
unknown `phone_number_id` must produce an `IGNORED` event and a 200.

**Out-of-order status.** Send `read` then `delivered` for the same message. Final status stays `READ`, and
`deliveredAt` is populated.

**Raw body integrity.** A signature computed over the raw body must verify where one computed over a re-serialised
body does not. This is the check that catches a middleware change silently breaking verification, which is the
failure that would otherwise go unnoticed for weeks.
