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
  integration/               # real database, one tenant per test  (not created yet)
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

301 tests across 12 files. Pure logic only: no database, no network, no clock dependence. 282 of them run under the
bare-node sandbox runner; the other 19 sit in two files that import `zod` and run only under Vitest, which is why
the table below sums higher than the count the sandbox gate prints.

| File | Tests | What it protects |
| --- | --- | --- |
| `member-rules.test.ts` | 54 | Who may act on whom. Exhaustive over every actor/target role pairing. |
| `permissions.test.ts` | 46 | The role/permission table, and that the primitives fail closed. |
| `invite-token.test.ts` | 29 | Invite token *shape*, because the value lands in a redirect path. Open-redirect and header-splitting inputs. |
| `password.test.ts` | 26 | scrypt hashing, constant-time verification, parameters recorded in the hash. |
| `tenant-isolation.test.ts` | 24 | `assertBelongsToWorkspace` and friends, including hostile inputs. |
| `order-totals.test.ts` | 23 | Order arithmetic in integer minor units. |
| `rate-limit.test.ts` | 23 | Window alignment, limit evaluation, bucket identity, client IP extraction. |
| `session-token.test.ts` | 23 | Token generation and hashing, session lifetime, sliding renewal, constant-time comparison. |
| `job-backoff.test.ts` | 18 | Retry backoff, jitter bounds, attempt ceiling, lock expiry, dedupe keys. |
| `webhook-signature.test.ts` | 16 | HMAC verification, including malformed and hostile headers. |
| `features.test.ts` | 12 | That the deployment flag gates before the plan entitlement, and that `resolveFeatures` serialises. Needs `zod` transitively, so the bare-node runner skips it. |
| `job-payloads.test.ts` | 7 | Job payload schemas. Needs `zod`, so the bare-node runner skips it. |

Two things in that table are worth singling out.

**`member-rules.test.ts` found a real privilege escalation.** It cross-checks `capabilitiesFor` — the function the
UI renders controls from — against the rules the mutations enforce, for every pairing. That surfaced a two-step
bypass: an ADMIN could demote a peer ADMIN and then remove them, achieving in two clicks what one click
forbade. None of the 44 hand-written rule tests had caught it, because each asserted an expected boolean for a
case someone had thought of. The lesson is now a standing rule: **where the UI mirrors a server-side decision,
test the agreement exhaustively across every input pairing** rather than asserting a handful of booleans.

**Three files test hostile input, not merely wrong input.** `tenant-isolation` and `webhook-signature` cover empty
strings, a bare `sha256` with no digest, a right-length signature made of NUL characters, multi-byte emoji.
`invite-token` covers fifteen values that would each redirect the browser off the application if they reached
`/invite/${token}` — a protocol-relative host, an absolute URL, parent traversal, a percent-encoded slash, an
encoded CRLF for header splitting, a backslash that some clients normalise to a slash. The interesting failure in
a security helper is rarely a plausible wrong value; it is the value that makes a comparison throw, return
`undefined`, or take a different code path. Note that the guard *rejects* these rather than escaping them, which
is the right choice when the safe set is as narrow as base64url.

---

## Integration tests

Not written yet. They need a live PostgreSQL instance and they land with the features they protect, in Phases 2
and 3. When they arrive they cover the webhook path end to end, message persistence and status transitions, order
creation, and — most importantly — cross-tenant denial against a real database.

The pattern each one follows: create two workspaces, act as a member of one, attempt to read and to mutate the
other's rows by id, and assert `NotFoundError` every time. Two tenants, not one, because a single-tenant test
cannot fail in the way that matters.

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

Of the six, order totals and rank rules pass today. The others need the features they describe.

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

- **`tools/syntax-check.mjs`** — runs Node's type stripper over all 81 TypeScript files. Catches syntax errors,
  unbalanced braces and malformed generics. It skips `.tsx` deliberately, because the stripper has no JSX parser
  and every component would report a false failure. It also scans every text file for a literal NUL byte, which
  sounds obscure but has happened four times: the file still parses, yet grep classifies it as binary and
  silently skips it from every subsequent search, including a security audit.
- **`tools/import-check.mjs`** — resolves all 395 first-party imports and checks each of the 812 named bindings
  exists in the target module. This is the closest available stand-in for the class of error `tsc` would catch,
  and it has caught real broken imports.
- **`tools/sandbox-test.mjs`** — executes the unit suite under bare Node with a resolver that understands the
  `@/…` alias. 282 tests genuinely run. Two files skip because they reach `zod`; a skip is reported as a skip
  rather than counted as a pass, and the runner names the missing dependency.

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

`tests/setup.ts` was referenced by `vitest.config.ts` and did not exist, which meant `npm run test` would have
failed on the first machine that ran it with a full install. It is written now. It was found while writing this
document — which is the argument for documentation that is checked against the code rather than composed from
memory.

`db/seed.ts` does not exist, so `npm run db:seed` fails. It arrives with Phase 2, and it must create a second
workspace, because the cross-tenant acceptance test needs two tenants to prove isolation between.

`prisma/migrations/` does not exist. The schema is complete but no migration has been generated.

There is no CI pipeline. `npm run verify` on a pull request, against a Postgres service container, is the
Phase 9 task.
