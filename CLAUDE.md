# CLAUDE.md — Engineering rules for WhatsApp OS

Read this before changing anything. `PROJECT_PLAN.md` is the roadmap, `ARCHITECTURE.md` is the map of the
system, and this file is the set of rules a change has to satisfy to be acceptable.

---

## The product in one paragraph

WhatsApp OS is a multi-tenant SaaS that connects a small business's official WhatsApp Business number and runs
their customer operation behind it: an AI agent that answers from the business's real data, plus a CRM, product
catalogue, order book, automation engine, and analytics. The initial market is Pakistan and the initial vertical
is online clothing and e-commerce sellers. The user is a shop owner, not an engineer.

---

## Commands

```bash
npm run dev            # development server
npm run build          # production build — must pass before a phase is complete
npm run start          # serve the production build
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit, strict
npm run test           # Vitest, unit + integration
npm run test:watch
npm run test:e2e       # Playwright
npm run verify         # lint + typecheck + test + build, the phase gate

npm run db:generate    # regenerate the Prisma client
npm run db:migrate     # apply migrations in development
npm run db:deploy      # apply migrations in production
npm run db:push        # sync schema without a migration (dev only)
npm run db:seed        # realistic seed data
npm run db:reset       # drop, migrate, seed
npm run db:studio      # Prisma Studio

npm run worker         # background job worker
```

---

## Non-negotiable rules

These are the ones that cause real damage when broken. Everything else in this file is a strong preference;
these are hard requirements.

**Every tenant query is scoped by `workspaceId`, taken from the `TenantContext`, never from user input.** If you
find yourself passing a workspace id in as a parameter from a request body, stop — that is the bug. Repositories
are the only layer allowed to build a `where` clause, and they inject the scope themselves.

**Single-record loads verify the row's `workspaceId` after reading and throw `NotFoundError` on mismatch.** Not
`ForbiddenError`. A forbidden response confirms the id exists in another tenant and lets an attacker enumerate.

**Authorization is checked in the service layer, server-side.** Not in the route, not in the component. Hiding a
button is a UX affordance. If a service can be reached from two entry points and only one checks, the product is
unprotected.

**Money is integer minor units with an explicit currency.** No floats, ever. All totals are computed
server-side from database prices. A total that arrives from a client or from a model is untrusted input.

**Webhook processing is idempotent.** Verify the HMAC over the raw body before parsing, dedupe on the provider
event id with a unique constraint, and return 200 for an already-seen event.

**Secrets stay server-side.** All environment access goes through `config/env.ts`. Never reference
`process.env` in code that can reach a client bundle. Never add a secret to a `NEXT_PUBLIC_` variable.

**The AI never states a fact it did not retrieve or receive from a tool.** Prices, stock, delivery times,
policies, discounts, order status, and payment confirmations come from tools or knowledge chunks. When the
support is absent, say so and hand off. This is tested, not trusted.

**The AI has no direct database access.** Tools only, each with a schema, a permission, an implicit workspace
scope, and validation.

**Use official WhatsApp Business Platform APIs only.** No web scraping, no QR session hacks, no browser
automation, no unsolicited mass messaging. This is not a style preference; unofficial automation ends the
business.

**Never invent an external API.** If you cannot read the provider's current documentation or the installed
package's own type definitions, write the interface plus a mock implementation and stop. A plausible-looking
endpoint that does not exist is worse than an honest gap.

---

## Code standards

TypeScript strict mode, and no `any` — use `unknown` and narrow it. No non-null assertions on values that could
actually be null; handle the case. Prefer `type` for object shapes and `interface` for contracts that
implementations must satisfy.

Server-side inputs are validated by Zod schemas in `server/validation`, and those same schemas back the forms so
that client and server cannot disagree about what is valid.

Errors are typed. Throw an `AppError` subclass carrying a stable machine code, an HTTP status, and a
user-safe message. Never leak a stack trace or an internal detail to a response. Log the detail with a request
id.

Files stay small enough to hold in your head. A React component past roughly 200 lines wants splitting; a
service past roughly 300 lines wants splitting. Both numbers are judgement calls, not lint rules, but the
instinct behind them is real: a file you cannot read in one sitting is a file where the tenant check gets
missed.

Comments explain *why*. The code already says what it does. A comment that restates the line above it is noise;
a comment explaining that status transitions are monotonic because Meta delivers callbacks out of order is
worth its space forever.

Names are meaningful and unabbreviated. No magic numbers — put them in `config/` with a name that explains the
choice.

Dependencies are added reluctantly, and only when the alternative is materially worse than writing it.

---

## Layering

```
route / server action  →  service  →  repository  →  Prisma
                       →  provider adapter  →  external API
```

Calls go one direction only. A route never touches Prisma. A repository never knows about HTTP, cookies, or
`Request`. A provider adapter never knows about our domain models — it speaks the vendor's language and returns
a normalised shape.

Business rules live in `server/services` and nowhere else, so an API route, a server action, and a background
job all enforce the identical rule. When the same rule is written twice it will drift, and the wrong copy will
be the one in production.

---

## Adding a feature

Work in this order, and do not skip the middle.

Model it in `prisma/schema.prisma` with `workspaceId`, timestamps, indexes, and constraints, then create a
migration. Write the Zod schemas. Write the repository with tenant scoping. Write the service with the
authorization check and the business rules. Write the route or server action as a thin adapter that validates,
delegates, and envelopes. Build the UI with loading, empty, populated, and error states. Add the permission to
the catalogue. Write tests covering the happy path, the authorization denial, and the cross-tenant denial.
Update the relevant document in `docs/`.

A feature is not done when it renders. It is done when it has a UI, a backend, a schema, validation,
authorization, error handling, tests, and documentation.

---

## Definition of done for a phase

Implement, then run `npm run verify` and fix everything it reports. Inspect the UI in the browser at desktop and
mobile widths. Check the database state is what you expected. Exercise the API. Update the docs. Only then mark
the phase complete.

Do not leave TypeScript errors, broken imports, failing tests, or dead code behind. "I'll fix it in the next
phase" is how a codebase stops being trustworthy.

---

## Things we do not do

No fake features. If a service is not configured, ship a labelled mock implementation — never a UI that
pretends. No "Coming soon" for core MVP functionality, and no buttons that do nothing: an action either works
or is visibly unavailable with a reason. No lorem ipsum — write real product copy, with realistic Pakistani
business examples where they fit. No real personal data in seed data, and no real phone numbers, addresses,
national ID numbers, or keys committed anywhere. No unofficial WhatsApp automation. No spam tooling; campaigns
respect messaging windows and honour opt-out.

---

## AI implementation notes

The prompt lives in `server/services/agent/prompt-builder.ts`, composed from the business profile, agent
settings, retrieved knowledge, and conversation context. Never inline a prompt in a component.

Context sent to the model is a rolling summary plus a bounded window of recent messages. Never the full
history — it is expensive and it is the main cause of context-window failures.

Every call writes a `UsageRecord` attributed to workspace, agent, conversation, message, provider, and model,
with token counts and a cost derived from the model price table in configuration. Route cheap models to
classification and summarisation; reserve capable models for customer-facing generation. Cap output tokens.

Confidence is computed from evidence — retrieval scores above a floor, tool availability and success, intent
match, sensitivity of the topic — and never read from the model's own claim about itself. A model's self-reported
confidence is a fluent guess.

Every tool has a Zod schema, a required permission, a workspace scope taken from the context rather than from
the model's arguments, input validation, and an audit entry when it mutates. `create_order` re-derives all
prices from the database and recomputes the total; anything the model proposed about money is discarded.

---

## Language and copy

The dashboard is English, with UI strings in the localisation structure rather than hard-coded, so Urdu and RTL
can be added properly later.

The AI handles English, Urdu, and Roman Urdu, including mixed input like "bhai black wala XL available hai?",
and replies naturally in kind — "Jee bilkul! Black color mein XL available hai. Price Rs. 3,499 hai aur COD bhi
available hai."

Write for a shop owner. "Teach your AI about your business", not "configure RAG embeddings". "Connect WhatsApp",
not "configure webhook". For every screen, ask whether someone who knows WhatsApp but not software would
understand it. If not, the screen is wrong, not the user.

---

## Design

Modern, premium, clean, minimal, trustworthy. Restrained colour, consistent spacing, clear typographic
hierarchy, subtle motion used only where it communicates something. Avoid heavy gradients, decorative graphics
that carry no information, and clutter. Support light and dark. Everything works from mobile to desktop, and the
inbox in particular has a real mobile layout rather than a squeezed desktop one.

---

## Git

Small, logical commits with messages that explain the change: `feat: add multi-tenant workspace model`,
`fix: prevent duplicate webhook processing`. Never commit `.env`, secrets, or generated artefacts.
