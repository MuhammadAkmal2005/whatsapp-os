# Database

PostgreSQL, accessed through Prisma. The schema lives in `prisma/schema.prisma` — 52 models and 40 enums, about
1,900 lines, and the single source of truth for the data model. It carries a reading guide at the top; this
document explains the conventions behind it and how to work with it.

```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector, pg_trgm]
}
```

Two extensions are required. **pgvector** stores knowledge-base embeddings, so retrieval is a query against the
same database as everything else rather than a second system to operate and keep consistent. **pg_trgm** backs
trigram search over contact names, product titles and message bodies, which is what makes "search" work on
partial and misspelled input — a shop owner types "kurtaa" and should still find the kurta.

`docker-compose.yml` uses the `pgvector/pgvector:pg16` image so both are present without extra setup.

Migrations live in `prisma/migrations/`, starting with `20260827215828_init`. Two things in this schema cannot be
expressed in Prisma and therefore only exist because a migration creates them by hand: the `vector` and `pg_trgm`
extensions, and the HNSW index on `knowledge_chunks.embedding`. Review generated SQL before committing it, and when
`prisma migrate dev` offers to drop something it cannot see, decline.

---

## Conventions

**UUID primary keys**, `@default(uuid()) @db.Uuid`. Sequential integers leak volume — a competitor who signs up
can read your order count off an id — and they make merging or sharding data painful later. The cost is a wider
index and no natural ordering, which is why every table also carries `createdAt`.

**`createdAt` and `updatedAt`** on every model, `@default(now())` and `@updatedAt`.

**snake_case table and column names** via `@@map` and `@map`, while the Prisma client stays camelCase. SQL is
read by hand during incidents, and `whatsapp_phone_numbers` is easier to type at a psql prompt than
`WhatsAppPhoneNumber`.

**Enums for status**, not strings. A typo in a status string is a row that silently never matches a filter; a
typo in an enum member is a compile error. 40 of them, which sounds excessive until you consider that every one
replaces a set of magic strings.

**Foreign keys with explicit `onDelete`.** Cascade where the child is meaningless without the parent (a message
without its conversation), restrict where deletion should be refused (a product with order history).

---

## Tenant scoping

**`workspaceId` is the tenant key, non-nullable on every tenant-owned model.** This is the column the entire
isolation model rests on — see `docs/SECURITY.md` for the three layers that enforce it.

Five models legitimately have no workspace at all, and each is marked `CROSS-TENANT` in the schema:

| Model | Why it has no workspace |
| --- | --- |
| `User` | A person may belong to several workspaces. Identity is global; membership is scoped. |
| `Session` | Belongs to a user, not to a workspace. The active workspace is resolved per request. |
| `VerificationToken` | Email verification and password reset, before any workspace is known. |
| `Plan` | Mirrors `config/plans.ts` into the database. The same plans are offered to everyone. |
| `RateLimitBucket` | Limits are keyed by action and identifier, and some identifiers are IPs with no workspace. |

Three more have no `workspaceId` column for structural reasons rather than by exemption. `Workspace` *is* the
tenant — its `id` is the key everything else points at. `ConversationParticipant` and `ContactTag` are join
tables whose scope is fixed by their parents; adding a denormalised `workspaceId` would create a second source of
truth that could disagree with the parent, which is a worse failure than the join it saves.

`WebhookEvent` and `Job` carry a **nullable** `workspaceId`, and they are the only rows in the message path that
do. An inbound webhook genuinely has no workspace until the receiving phone number is resolved, so the column is
filled during processing rather than at insert. Treat a null there as "not yet resolved", never as "belongs to
everyone".

---

## Money

**Integer minor units plus an explicit currency**, everywhere. Paisa for PKR, cents for USD. Floating point never
touches a price.

`0.1 + 0.2 !== 0.3` in every language with IEEE-754 doubles, and a shop owner whose Rs. 7,248 order total shows
as Rs. 7,247.99 has lost trust in the product, not in the arithmetic. Storing minor units makes every total exact
and every comparison reliable.

The currency travels with the amount rather than being assumed per workspace, because a workspace can plausibly
take PKR from local customers and USD from overseas ones, and a bare number with an implied currency is the kind
of ambiguity that produces a 280× pricing error.

`lib/money.ts` holds the arithmetic and formatting; `server/domain/order-totals.ts` holds the order maths. Do not
compute a total anywhere else.

---

## Soft deletion

`deletedAt` exists on exactly five models: `User`, `Workspace`, `Contact`, `Product`, `Order`.

The rule is whether a business owner would reasonably expect the record to survive removal. A product referenced
by last month's orders must not vanish, or the order history becomes unreadable. A contact with a conversation
history is the same. Everything operational — sessions, jobs, webhook events, rate-limit buckets, analytics rows
— is hard-deleted, because keeping it costs storage and query complexity for no benefit anyone will ever ask for.

Soft-deleted rows must be filtered in the repository, not at the call site. A `deletedAt: null` predicate that
lives in a service is one someone will forget, and the symptom is a deleted product reappearing in the AI's
answers.

---

## Indexes

79 `@@index` declarations and 20 `@@unique` constraints.

**Composite indexes lead with `workspaceId`,** because every real query filters on it first. A composite index
starting there serves the tenant scope and the subsequent sort in one structure, and PostgreSQL can use its
leading columns for scope-only queries too. An index that starts with the sort column instead is useless to a
scoped query, which is the most common indexing mistake in a multi-tenant schema.

Unique constraints do real work rather than documenting intent:

- `@@unique([provider, providerEventId])` on `WebhookEvent` — **the deduplication mechanism.** A replayed Meta
  delivery conflicts on insert and is answered 200 immediately. An application-level "have I seen this?" check
  races between two concurrent deliveries; a unique index does not. This is why idempotency is a constraint and
  not a code path. The key is composite rather than the event id alone because a payment provider and Meta can
  independently mint the same id string, and a collision between them would silently discard a real event.
- Workspace slugs are globally unique; membership is unique per user and workspace.
- `ConversationParticipant` is unique per conversation and member, and per conversation and contact.
- Product SKUs are unique per workspace, not globally — two unrelated shops may both sell `KURTA-BLK`.

---

## Vector search

`KnowledgeChunk.embedding` is `Unsupported("vector")?` in the schema and `vector(1536)` in the database. Prisma has
no native vector type, so the column is declared as unsupported — which also means Prisma cannot see the width, and
`EMBEDDING_MODELS` in `config/models.ts` is the source of truth every writer validates a vector against — and it is
queried with `$queryRaw`.

That raw query is the one place tenant scoping cannot be inherited from a repository's typed `where` clause, so it
is written with a parameterised `workspaceId` and reviewed accordingly. **Never interpolate a value into that
SQL.** It is the single highest-risk query in the codebase on both counts — injection and cross-tenant leakage.

The index is HNSW with `vector_cosine_ops`, created in
`20260905000000_embedding_provenance_and_hnsw_index` because Prisma cannot express it. `prisma migrate dev` may
offer to drop it as drift; decline. It only serves `ORDER BY embedding <=> $query LIMIT $k`, so the retrieval query
keeps that shape — the tenant filter and the distance ceiling ride on top of the ordered scan rather than replacing
it. NULL vectors are not indexed and are excluded in SQL.

1536 dimensions matches `gemini-embedding-001` requested at 1536 output dimensions, truncated from its native 3072
and re-normalised by the provider. Changing `AI_EMBEDDING_MODEL` to a model with a different width requires a
migration, and changing it to a same-width model still invalidates every stored embedding, because vectors from
different models are not comparable. Re-embed before trusting retrieval.

`KnowledgeChunk.embeddingModel`, `embeddingDims` and `embeddedAt` record what produced the vector in that row.
`KnowledgeBase.embeddingModel` is what the workspace's corpus is *meant* to be built with and can be edited under a
corpus built with something else, which is why "does this chunk need re-embedding" is only answerable from the chunk.

---

## Working with the schema

```bash
npm run db:migrate     # create and apply a migration in development
npm run db:deploy      # apply pending migrations in production
npm run db:push        # sync without a migration — development only, never on shared data
npm run db:generate    # regenerate the Prisma client
npm run db:studio      # browse the data
npm run db:reset       # drop, migrate, seed
```

Adding a model, in order: declare it in `prisma/schema.prisma` with `workspaceId`, timestamps, indexes and
constraints; run `npm run db:migrate` and read the generated SQL; write the repository with tenant scoping; then
proceed as `CLAUDE.md` describes.

**Review generated SQL before committing.** Prisma will happily produce a migration that drops a column and its
data when a rename was intended. In development that costs you a reset; in production it is unrecoverable.

**Migrations are forward-only in production.** `prisma migrate reset` destroys data and exists for development.
To undo a deployed migration, write a new one that reverses it.

**Additive migrations deploy safely; destructive ones need two steps.** Dropping a column that running code still
reads takes the application down between deploy and rollout, so ship the code that stops reading it first, then
drop it in a later migration.

---

## Seed data

`npm run db:seed` runs `db/seed.ts`. **That file does not exist yet** — it arrives with Phase 2, when there are
products, contacts and orders worth seeding.

When written, it creates a realistic Pakistani clothing business — "Akmal Fashion", a product catalogue of
kurtas and shalwar kameez with sizes and colours, 10–20 contacts, 20–30 orders, 20+ conversations, and a
knowledge base of FAQ, shipping, returns and payment entries — so the dashboard is immediately testable and every
empty state has a populated counterpart to compare against.

All of it is fictional. **No real phone number, address, national ID number or person's name goes into seed data**
, and it must also include a second workspace, because the cross-tenant acceptance test needs two tenants to
prove isolation between.
