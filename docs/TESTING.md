# Testing

Tests exist to make a rule survive the person who did not read the document. Tenant isolation, rank rules, money
arithmetic and webhook idempotency are all things a reasonable developer can break with a plausible-looking
change, and the test is what turns that into a failed build instead of a customer incident.

So the bar is not coverage percentage. It is: **for every rule in `CLAUDE.md` that would be expensive to get
wrong, there is a test that fails when it is broken.**

---

## Commands

```bash
npm run test            # Vitest, unit + integration
npm run test:watch      # Vitest in watch mode
npm run test:coverage   # with a v8 coverage report
npm run test:e2e        # Playwright
npm run verify          # lint + typecheck + test + build — the phase gate

npm run test:sandbox    # the unit suite under bare node, no node_modules needed
npm run verify:sandbox  # syntax + imports + test:sandbox
```

`npm run verify` is what "done" means. A phase is not complete because the code exists; it is complete when
verify passes, the UI has been looked at on a phone-width viewport, and the docs are updated.

---

## Layout

```
tests/
  setup.ts                   # env for every run; forces the test database
  unit/                      # pure logic, no I/O
  integration/               # real database, one tenant per test
    fixtures.ts              # workspaces, members and contacts inserted through Prisma
    contact/                 # grouped by module
  e2e/                       # Playwright, real browser              (not created yet)
  stubs/server-only.mjs      # no-op stand-in for the server-only guard
  sandbox-resolver.mjs       # @/… alias + .ts resolution for bare node
  sandbox-resolver-hooks.mjs
  vitest-shim.mjs            # describe/it/expect for the bare-node runner
```

`vitest.config.ts` uses `environment: 'node'`, `globals: false` — imports are explicit, so a reader can tell where
`expect` came from — and `fileParallelism: false`, because integration tests share a database and must not race.
Serialising unit files costs almost nothing and buys determinism.

### `tests/setup.ts` forces the test database

The setup file pins `DATABASE_URL` to `TEST_DATABASE_URL`, or to the throwaway container on port 5433 from
`docker-compose.yml` if that is unset. This is a safety control, not a convenience. Integration tests truncate
tables; if `DATABASE_URL` still pointed at the development database when someone ran `npm test`, the suite would
delete the data they were looking at a minute earlier. Redirecting in setup means the mistake is not available to
make.

It also forces every provider to its mock, so no test can reach a live API, send a real WhatsApp message, or
spend money on a model call. And it supplies the values `config/env.ts` demands, because that module parses
`process.env` at *import* time — a test that transitively pulls in a service would otherwise die during module
loading with an error about configuration rather than about the code under test. Setup files run before the test
file's imports are evaluated, which is why this works there and would not work in a `beforeAll`.

---

## Unit tests

Pure logic only: no database, no network, no clock dependence. Almost all of them run under the bare-node sandbox
runner; two files import `zod` and so run only under Vitest. The per-file counts below are an inventory of what
each file is responsible for — for the current totals, run the command, whose output is never out of date.

| File | Tests | What it protects |
| --- | --- | --- |
| `member-rules.test.ts` | 54 | Who may act on whom. Exhaustive over every actor/target role pairing. |
| `permissions.test.ts` | 46 | The role/permission table, and that the primitives fail closed. |
| `invite-token.test.ts` | 29 | Invite token *shape*, because the value lands in a redirect path. Open-redirect and header-splitting inputs. |
| `phone.test.ts` | 29 | E.164 normalisation — the contact identity key. That every way of writing one number collapses to one value, and that the output is always valid E.164. |
| `password.test.ts` | 26 | scrypt hashing, constant-time verification, parameters recorded in the hash. |
| `tenant-isolation.test.ts` | 24 | `assertBelongsToWorkspace` and friends, including hostile inputs. |
| `order-totals.test.ts` | 23 | Order arithmetic in integer minor units. |
| `rate-limit.test.ts` | 23 | Window alignment, limit evaluation, bucket identity, client IP extraction. |
| `session-token.test.ts` | 23 | Token generation and hashing, session lifetime, sliding renewal, constant-time comparison. |
| `job-backoff.test.ts` | 18 | Retry backoff, jitter bounds, attempt ceiling, lock expiry, dedupe keys. |
| `webhook-signature.test.ts` | 16 | HMAC verification, including malformed and hostile headers. |
| `features.test.ts` | 12 | That the deployment flag gates before the plan entitlement, and that `resolveFeatures` serialises. Needs `zod` transitively, so the bare-node runner skips it. |
| `contact-capability.test.ts` | 9 | Which roles may edit, remove, assign and export customers, and that the flags the UI renders from agree with what the service enforces. |
| `job-payloads.test.ts` | 7 | Job payload schemas. Needs `zod`, so the bare-node runner skips it. |

Three things in that table are worth singling out.

**`member-rules.test.ts` found a real privilege escalation.** It cross-checks `capabilitiesFor` — the function the
UI renders controls from — against the rules the mutations enforce, for every pairing. That surfaced a two-step
bypass: an ADMIN could demote a peer ADMIN and then remove them, achieving in two clicks what one click
forbade. None of the 44 hand-written rule tests had caught it, because each asserted an expected boolean for a
case someone had thought of. The lesson is now a standing rule: **where the UI mirrors a server-side decision,
test the agreement exhaustively across every input pairing** rather than asserting a handful of booleans.

**Four files test hostile input, not merely wrong input.** `tenant-isolation` and `webhook-signature` cover empty
strings, a bare `sha256` with no digest, a right-length signature made of NUL characters, multi-byte emoji.
`invite-token` covers fifteen values that would each redirect the browser off the application if they reached
`/invite/${token}` — a protocol-relative host, an absolute URL, parent traversal, a percent-encoded slash, an
encoded CRLF for header splitting, a backslash that some clients normalise to a slash. `phone` passes `null`,
`undefined`, a number and an object, because contact details arrive from a webhook body as often as from a form.
The interesting failure in a security helper is rarely a plausible wrong value; it is the value that makes a
comparison throw, return `undefined`, or take a different code path. Note that the guard *rejects* these rather
than escaping them, which is the right choice when the safe set is as narrow as base64url.

**`phone.test.ts` found a real defect while being written.** `normalisePhone` returned `+0300123456` for an input
written as `+0300…`, and for any national number given with a `defaultCountry` the module had no rule for. No
country calling code begins with zero, so that value describes no reachable number — and it would have been stored
as `Contact.phoneE164`, the identity key, producing a contact that could never receive a message and could never be
merged with the real one. The fix routes both fallback paths through `isValidE164`; the standing lesson is to
**assert the output invariant, not just the happy-path mapping.** The suite now checks that no non-null result
fails `isValidE164`, which is the assertion that caught it.

---

## Integration tests

These run against a real PostgreSQL database, because the properties they check are properties of the queries. A
mocked Prisma client would let a repository that forgot its `workspaceId` pass: the mock returns whatever the test
told it to.

Nothing starts the database for you. Bring up the throwaway container, apply the schema to it, then run the suite:

```bash
docker compose up -d postgres-test
DATABASE_URL=postgresql://whatsapp_os:whatsapp_os@localhost:5433/whatsapp_os_test npm run db:push
npm test
```

The `DATABASE_URL` override on the middle line matters. `tests/setup.ts` redirects the *test process* to port 5433,
but `prisma db push` is a separate process that reads your `.env` — without the override it would push the schema
to your development database and leave the test one empty, and the failure reads as a missing table rather than as
a missing step.

### `fixtures.ts`

Fixtures insert through Prisma, never through the services. A fixture that called `createContact` to set up a test
of `createContact` would pass whenever the service was self-consistently wrong, which is precisely the failure mode
worth catching.

`createWorkspaceFixture` returns a `TenantContext` for the workspace's owner, built by hand rather than resolved
from a session — the session path has its own tests, and going through it here would make every integration test
depend on cookie handling. `createMemberFixture` adds a member at any role, so a test can hold a real AGENT or
VIEWER context. `resetDatabase` truncates `users` and `workspaces` with `CASCADE`: they are the two roots, so
cascading from both clears the schema without naming forty tables that would need maintaining every time a model
is added.

Slugs and emails carry a random suffix because both are globally unique, and two fixtures colliding on a unique
index produces a failure that reads as a bug in the code under test. Emails use the reserved `example.test` TLD and
phone numbers are fictional.

### `contact/contact-isolation.test.ts`

Acceptance test #96, against the service rather than the assertion helper. `tests/unit/tenant-isolation.test.ts`
proves `assertBelongsToWorkspace` refuses a foreign row, but it would still pass if a repository never called it.
This one creates a customer in Workspace A and then, holding a valid context for Workspace B, attempts every read
and every mutation the module offers: read, list, search, edit, status, lead stage, note, assign, remove. Each must
raise `NotFoundError`, and the write assertions re-read the row afterwards to confirm nothing was touched.

Three cases in it are worth naming.

**Indistinguishability is asserted, not assumed.** One test compares the error for a foreign customer against the
error for an id that never existed — code, status and message — because "404 not 403" is only half the property. If
the two differed in their message, the distinction an attacker needs would still be there.

**Assignment is tested in the direction a foreign key does not catch.** `Contact.assignedToMemberId` references
`workspace_members` globally, so the database would happily accept a competitor's employee. A crafted form post
doing that would park the customer in a queue inside another business, along with their phone number and notes.
The refusal comes from `resolveAssignee`, and this is the test that keeps it there.

**A leaked cursor is treated as a plausible input.** Ids travel in URLs, so the pagination cursor is the most
likely way a foreign id reaches a query. The assertion is that Workspace A's row never appears in Workspace B's
page, and it deliberately tolerates either a rejection or an empty result — pinning which one Prisma does would
make the test a version detector rather than a tenancy check.

---

## Acceptance tests

Six, from `docs/SECURITY.md`, and they are the reason the rest of the suite exists.

**Cross-tenant denial.** A customer, an order and a conversation in Workspace A; every read and every mutation
attempted from Workspace B must fail, with 404 rather than 403. A 403 confirms the id is real and lets an
attacker count a competitor's orders.

**Role authorization.** An AGENT cannot modify a subscription, add or remove an owner, reach another workspace,
or change platform settings — verified by calling the service directly, never by checking that a button is
hidden.

**Rank rules.** An ADMIN cannot act on a peer ADMIN or the OWNER by any route, including a two-step one.

**Webhook idempotency.** Deliver the identical webhook twice; exactly one message, one order and one event exist
afterwards.

**Order totals.** Rs. 3,499 × 2 plus Rs. 250 delivery equals Rs. 7,248, computed server-side, with a
client-supplied total ignored rather than validated.

**AI grounding.** Black Kurta at Rs. 3,499 with stock 5 answers "Black kurta XL available?" from the data. Set
stock to 0 and it must not say available. With no return policy stored, it must not invent one. This is the test
that distinguishes the product from a chatbot, and it is why grounding is tested rather than trusted.

Of the six, order totals and rank rules pass today. Cross-tenant denial and role authorization are written for
contacts in `tests/integration/contact/contact-isolation.test.ts` but have never executed, because this
environment has no database — treat them as unverified until someone runs them. They will need extending to
orders and conversations as those modules land. Webhook idempotency and AI grounding need the features they
describe.

---

## End-to-end

Playwright is in `devDependencies` and `npm run test:e2e` is wired, but **`playwright.config.ts` and `tests/e2e/`
do not exist yet.** The command will fail until they do. The journey to automate, once the features exist: sign
up, create a workspace, add a product with a price and stock, configure the agent, add knowledge, test in the
playground, simulate an inbound customer message, watch the AI reply, place an order, and see it on the
dashboard.

---

## Writing a test

Test the rule, not the implementation. A test that asserts a service calls a repository method breaks when you
refactor and passes when the rule is wrong — it is a cost with no benefit.

Every feature needs three cases: the happy path, the authorization denial, and the cross-tenant denial. The
second and third are the ones that would otherwise ship broken, because the happy path is what you were already
looking at while building it.

Prefer real objects to mocks. Mock at the provider boundary — the WhatsApp API, the model, the payment gateway —
and nowhere further in. A mocked repository tests that your mock behaves like your assumption about the database.

Name the test after the behaviour and the reason, so a failure reads as a sentence: `refuses a signature of the
right length made of NUL bytes`, not `test signature 4`.

When you fix a bug, first write the test that fails. A bug that arrived once can arrive again, and the fix
without the test is an invitation.

---

## What cannot run here, and what to run yourself

This project was authored in an environment with **no package registry and no PostgreSQL instance**, so
`node_modules` was never installed. That constrains what has actually been executed, and pretending otherwise
would be worse than saying so.

`npm run verify:sandbox` is the local substitute. It runs three checks that need nothing but Node:

- **`tools/syntax-check.mjs`** — runs Node's type stripper over every `.ts` file. Catches syntax errors,
  unbalanced braces and malformed generics. It cannot parse `.tsx`, because the stripper has no JSX parser and
  every component would report a false failure, so it prints the number of files it skipped on every run — around
  a third of the codebase. That is a real gap and the summary line says so rather than implying the components were
  checked; they are covered by import-check alone until `npm run typecheck` runs on a machine with `node_modules`.
  It also scans every text file for a literal NUL byte, which sounds obscure but has happened four times: the file
  still parses, yet grep classifies it as binary and silently skips it from every subsequent search, including a
  security audit.
- **`tools/import-check.mjs`** — resolves every first-party import across both `.ts` and `.tsx` and checks that each
  named binding exists in the target module. This is the closest available stand-in for the class of
  error `tsc` would catch, it is the *only* automated check that reads the components, and it has caught real
  broken imports.
- **`tools/sandbox-test.mjs`** — executes the unit suite under bare Node with a resolver that understands the
  `@/…` alias. Most of the unit tests genuinely run. Two files skip because they reach `zod`; a skip is reported as
  a skip rather than counted as a pass, and the runner names the missing dependency. Integration files are found and
  listed as `DEFER`, never attempted — they need a database, and a wall of connection errors on every run would
  train the reader to ignore red output. Listing them keeps them visible: **a suite that appears in no local run is
  one nobody notices has drifted away from the code it covers.**

The exact file and import counts are deliberately not written down here. They moved with every commit and the line
went stale three times in a week, which taught the wrong lesson twice: that the document was unreliable, and that
the numbers mattered. Run the command — it prints them, and its output is never out of date.

**These are not a substitute for the real gate.** Still to be run on a machine with a registry and a database:

```bash
npm install
npm run lint          # ESLint, including the Prisma import boundary
npm run typecheck     # tsc --noEmit — the only real type check
npm run test          # Vitest; first run of tests/setup.ts and the server-only alias
npm run build         # next build
docker compose up -d
npm run db:migrate    # generates the initial migration; review the SQL
npm run db:seed       # db/seed.ts does not exist yet
npm run test:e2e      # needs a Playwright config first
```

Two of those have never executed even once and should be treated as unverified: `tests/setup.ts` and the
`server-only` alias in `vitest.config.ts` were both written to fix problems reasoned about rather than observed.
The alias exists because `server-only` throws outside the `react-server` condition and 28 modules import it, so
the first test to reach a repository would have failed on import. That reasoning is sound but untested.

---

## Known gaps

The integration suite has never executed. `tests/integration/fixtures.ts` and the contact isolation tests are
written against the real service and the real schema, and every signature in them was checked against source, but
"checked against source" is not "ran". The first run on a machine with a database should be treated as part of
writing them, not as a formality — the likely failures are a table name in the `TRUNCATE`, a column default, and
whatever Prisma does with a cursor its `where` clause excludes.

`tests/setup.ts` was referenced by `vitest.config.ts` and did not exist, which meant `npm run test` would have
failed on the first machine that ran it with a full install. It is written now. It was found while writing this
document — which is the argument for documentation that is checked against the code rather than composed from
memory.

`db/seed.ts` does not exist, so `npm run db:seed` fails. It arrives with Phase 2, and it must create a second
workspace, because the cross-tenant acceptance test needs two tenants to prove isolation between.

`prisma/migrations/` does not exist. The schema is complete but no migration has been generated.

There is no CI pipeline. `npm run verify` on a pull request, against a Postgres service container, is the
Phase 9 task.
