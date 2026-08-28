# Local verification checklist (Windows)

Run these on a Windows machine with Node 20+, npm, and Docker Desktop running. Commands are
written for **PowerShell** (the default Windows terminal). Run them from the project root.

The one-command gate is `npm run verify` (lint + typecheck + test + build). Steps 1–4 set it
up; step 8 explains why the test DB has to be prepared first. Do the whole list once, then
`npm run verify` is all you need on later runs.

---

## 0. Prerequisites

```powershell
node -v          # must be >= 20
docker version   # Docker Desktop must be running
```

Success: Node reports v20 or newer, and `docker version` prints a Server section (not "cannot
connect" — if it does, start Docker Desktop and wait for it to say Running).

---

## 1. Install dependencies

There is no `package-lock.json`, so use `install`, not `ci`.

```powershell
npm install
```

Success: finishes with no `npm error` lines and a `node_modules\` folder now exists. A few
`npm warn deprecated` lines are normal and harmless.

---

## 2. Environment file

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Open `.env` and paste that output as the value of **`AUTH_SECRET=`** (it ships blank, and the
app refuses to boot without a 32+ byte value). Everything else can stay as-is for local
verification: `DATABASE_URL` already points at the Docker database from step 3, and the AI,
WhatsApp, payment, storage and email providers all default to `mock`/`local`/`console`, so **no
API keys are needed**.

Success: `.env` exists and `AUTH_SECRET` is filled in. (`config/env.ts` validates every
variable at startup and will name any other missing one explicitly if it complains.)

---

## 3. Start PostgreSQL

Starts two containers: the dev database on **5432** and a throwaway test database on **5433**.

```powershell
docker compose up -d
docker compose ps
```

Success: `docker compose ps` lists `whatsapp-os-postgres` and `whatsapp-os-postgres-test`, both
`running (healthy)`. Give them ~10 seconds to reach healthy.

---

## 4. Prisma: generate client + create the first migration

No migration exists yet, so this creates the initial one from `prisma/schema.prisma`. The
`--name init` avoids the interactive name prompt.

```powershell
npm run db:migrate -- --name init
```

Success: a folder `prisma\migrations\<timestamp>_init\` is created, the run ends with **"Your
database is now in sync with your schema"**, and the Prisma client is generated. The SQL should
include `CREATE EXTENSION` for `vector` and `pg_trgm` (the `pgvector/pgvector` image provides
both). Skim the generated `migration.sql` once — it is worth reviewing the first time.

> `npm run db:seed` seeds the database with realistic workspaces, products, variants, orders, and contacts.

---

## 5. Typecheck — the real one

This is `tsc --noEmit`. It is the check the offline sandbox gate cannot run (it can't type-check
or even JSX-parse `.tsx` files), so this is the step most likely to surface something new.

```powershell
npm run typecheck
```

Success: no output and the command exits 0. Any error prints `file(line,col): error TSxxxx: …` —
fix those before trusting the build.

---

## 6. Lint

```powershell
npm run lint
```

Success: **"✔ No ESLint warnings or errors"**. This also enforces the Prisma import boundary
(repositories only), so a leaked `prisma` import in a service or route shows up here.

---

## 7. Build

`npm run build` runs `prisma generate` then `next build`. It reads `.env`, so step 2 must be
done first.

```powershell
npm run build
```

Success: ends with **"Compiled successfully"** and prints the route table (a list of `/dashboard`,
`/products`, `/contacts`, `/settings`, etc.), exit 0. No "Failed to compile".

---

## 8. Tests

`tests/setup.ts` automatically redirects the *test process* to the 5433 test database, so `npm
test` never touches your dev data. But the test database needs the schema pushed into it first,
and that push is a separate process that reads `.env` (port 5432) — so it needs a one-time
override. The project docs give this in bash; the PowerShell form is:

```powershell
# One-time (and again only after a schema change): push schema into the 5433 test DB
$env:DATABASE_URL = "postgresql://whatsapp_os:whatsapp_os@localhost:5433/whatsapp_os_test"
npm run db:push
Remove-Item Env:DATABASE_URL   # clear the override so nothing else uses it

# Run the full suite
npm test
```

Success: the unit suite passes (300+ tests across permissions, member-rules, tenant-isolation,
order-totals, phone, password, webhook-signature, and the product suites), including the two
`zod` files that only run under Vitest. The integration test
`tests/integration/contact/contact-isolation.test.ts` will **execute for the first time ever**
here — if it fails, treat it as expected first-run friction (a `TRUNCATE` table name, a column
default, or a cursor edge case), not as a mistake in your setup.

To run only the fast, no-database checks instead: `npm run test:sandbox`.

---

## 9. One-shot gate (after the above)

With `.env` set, both DB containers up, and the test schema pushed (step 8), the whole gate is:

```powershell
npm run verify        # = lint + typecheck + test + build
```

Success: all four stages complete with exit 0.

---

## Known to fail today — skip these

These are wired but their targets are not built yet, so they will error. That is expected, not a
setup problem:

- `npm run db:seed` — `db/seed.ts` does not exist yet.
- `npm run test:e2e` — no `playwright.config.ts` or `tests/e2e/` yet.

---

## Teardown

```powershell
docker compose down          # stop the databases (keeps dev data)
docker compose down -v       # also delete the dev data volume
```
