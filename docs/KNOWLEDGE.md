# Knowledge

What a business teaches its assistant. A shop owner writes their delivery charges, their exchange policy and
the questions customers keep asking; the assistant answers from those words and from nothing else it has not
been given. This document is the engineering side of that: what the product accepts, what happens to it, and
what to do when a piece of knowledge does not come out the other end.

The customer-facing side of the same feature is deliberately smaller than what is described here, and the
vocabulary is different. That difference is the subject of its own section, and it is enforced by a test.

---

## What can be taught (V1)

Two kinds, and only two.

**Text** is a block of prose with a title — delivery information, a returns policy, the rules for a sale. It is
the general case and it is what most businesses reach for first.

**Q&A** is one question with one answer. It exists because a great deal of what a shop knows is shaped that way
already, and because a question and its answer belong together: they are stored, processed and retrieved as a
single unit, so the answer never arrives without the question that frames it.

`KnowledgeType` in the schema also carries `PDF`, `DOCX`, `URL`, `CATALOG` and `POLICY`. **None of them are
implemented, and the validation boundary rejects them.** They stay in the enum because removing an enum value
is a destructive migration and these are the next things the feature grows; a request naming one of them fails
as invalid input rather than being accepted into a pipeline that cannot process it. What is missing along with
them is deliberate too: no file upload, no object storage, no fetching a URL, no document parsing.

---

## What the source may contain

Limits are enforced in two units, because they protect two different things. Characters bound what the
assistant will have to read; bytes bound what the database stores, and one Urdu character costs three bytes
where one English character costs one. A document at the character limit in Urdu would be triple the storage
of the same limit in English, so both are checked: 50,000 characters and 200,000 bytes of text, a 500-character
question, a 5,000-character answer, a 200-character title.

Text is normalised before it is stored, and the stored source is the normalised form — so what the owner sees
when they reopen the dialog is exactly what the assistant was taught. Normalisation composes Unicode to NFC,
strips a leading byte-order mark, turns Windows and old-Mac line endings into plain newlines, removes
zero-width spaces, collapses runs of spaces and blank lines, and trims trailing whitespace from every line.

**It does not touch the characters that carry meaning in Urdu.** The zero-width non-joiner and zero-width
joiner are preserved, because in Urdu and Persian they are not invisible cruft — they decide whether adjacent
letters join, and stripping them changes words. Bidirectional marks are preserved for the same reason: they
decide how a mixed Urdu-and-English line is laid out. Nothing is lowercased, transliterated or stripped of
punctuation; the assistant is being taught a shop's own words, and "Rs. 3,499" is not the same fact as
"rs 3499".

Saving the same thing twice is refused. Every document carries a hash of its type, title and body, unique per
workspace, so a second copy conflicts in the database rather than in a service-layer check that two concurrent
saves could both pass. The owner is told they have already written this one; their plan allowance is not
charged twice for it.

---

## The lifecycle of one save

A save writes a row and queues a job. Nothing is processed inline, because processing calls an external service
and a form submission that waits on one is a form submission that times out.

```
save → PENDING ─claim→ PROCESSING ─success→ READY
                            └─────failure→ FAILED
edit (READY or FAILED) → PENDING          retry (FAILED) → PENDING
```

The job type is `knowledge.ingest_document`, carrying only a workspace id and a document id — never the source
text, which would put a copy of the content in the queue and let a stale job publish superseded words. Its
dedupe key is the workspace and document together, so a burst of edits collapses to one queued attempt rather
than to five attempts that will each embed the same text.

One attempt reads the row, splits the source into sections, embeds them, and then publishes all of them in a
single transaction: lock the row, confirm it is still the version that was embedded, delete the old sections,
insert the new ones, mark the document ready, record what it cost. **The external calls all happen before the
transaction opens**, because a transaction held open across a network call is a lock held for as long as
somebody else's service takes to answer.

The consequence of publishing that way is the property that matters most while an edit is being processed: a
document's sections are replaced all at once or not at all. There is never a moment where half the old policy
and half the new one are both answerable, and re-processing a document that is already ready does not take its
answers away in the meantime — the previous version keeps serving until the new one is complete. Retrieval does
not filter on document status, which is what makes that true.

---

## Sections

The source is split into overlapping pieces, called **sections** in the product and nothing else anywhere the
owner can see. Sizes are in characters: around 900 per section, 1,200 as a hard maximum, about 150 characters
of overlap between neighbours, and 80 characters below which a trailing fragment is merged back into the
section before it rather than left to stand alone. The hard maximum is not an independent choice — it is the
same constant the assistant's own retrieval budget uses, so a section can never be too large to be quoted.

Where a split lands is chosen by preference, not by counting: a paragraph break first, then a line break, then
the end of a sentence — including the Urdu full stop `۔` and question mark `؟`, which is the difference between
splitting Urdu prose at its sentences and splitting it mid-clause — then a word boundary, and only then a
position chosen for safety. That last fallback still never splits a surrogate pair or separates a combining
mark from the letter it belongs to, because half of an emoji or a bare vowel mark is not text.

A Q&A is one unit: `Q: …` then `A: …`, in one section when it fits. When the answer is too long for one, the
question stays whole and is repeated at the top of every section the answer is spread across, so no piece of
the answer is ever retrieved without knowing what it answers.

Positions are dense and zero-based, and a document that has any content at all always produces at least one
section. A document is capped at 400 sections, which the content limits already make unreachable — the cap is
there so that a future change to those limits cannot quietly turn one save into a thousand embedding calls.

Sections are embedded in batches of 32 rather than one request per section, sequentially within an attempt. The
batching is not a performance flourish: one request per section is how a fifty-section handbook turns into fifty
billable calls, and unbounded parallel batches are how one owner's large save exhausts a rate limit that
everybody shares.

---

## When it fails

Failures are sorted into the ones worth trying again and the ones that never will be, using the same
classification the rest of the AI runtime uses rather than a second taxonomy invented here. A rate limit, a
provider that is down, a network error, a timeout, a deadlock: those retry. Content that is empty or too large,
an unsupported type, a misconfigured service, an answer of the wrong shape: those do not, and the attempt is
finished rather than repeated three times to reach the same conclusion.

Each document that fails carries a code — `CONTENT_EMPTY`, `CONTENT_TOO_LARGE`, `AI_UNAVAILABLE`, `AI_FAILED`,
`NOT_CONFIGURED` — and, separately, one sentence written for the owner. The two are not the same string. The
code is for us and appears in logs; the sentence is what appears under the title of a row that did not work,
and it contains no status code, no provider name, no model name and no stack frame. A person who cannot fix
our infrastructure is not helped by being shown it.

A retryable failure marks the document and **rethrows**, which is the part that is easy to get wrong. The queue
owns the attempt budget — three attempts for this job type, each rescheduled further into the future than the
last — and a handler that swallows the error tells the queue the job succeeded. So the service records what
happened for the owner to read and then lets the error out, and the queue decides whether there is another
attempt or whether the job goes to the dead letter.

### Retry

A dead job keeps its dedupe key on purpose: the row stays visible to whoever is looking at the queue, and it
cannot be silently re-enqueued behind their back. The cost of that decision is that a naive "just queue it
again" does nothing at all — the enqueue is answered with the dead row that is holding the key, reports
success, and no work happens.

So **Retry releases the key from that exact row, in that exact workspace, and then queues.** The dead job stays
dead and stays visible; only its claim on the key is given up. What the owner gets is a new job with a fresh
attempt budget, which is what they asked for when they pressed the button. This is tested end to end — three
attempts, dead letter, retry, and a second handler execution that actually publishes — because "a row appeared
in the queue" is not the same as "retry works".

Retry is also offered for a document that has been processing longer than the queue's own lock timeout. A
worker that claimed a job and then died leaves a row saying "Processing…" with nothing on the other end; past
the timeout the queue itself considers that worker gone, so the row stops pretending and offers the way out.

### An edit while it is being processed

The dangerous version of this is not the edit failing — it is the edit appearing to succeed and then being
overwritten by the attempt that was already running. An attempt reads version one, spends several seconds
embedding it, and in that time the owner corrects a delivery charge. If both attempts reach the publish step,
whichever commits second wins, and that can be the one holding the *older* words: the assistant goes on
quoting the price the owner just fixed, and nothing anywhere reports a problem.

What prevents it: the attempt carries the content hash of the version it embedded, and inside the publish
transaction it locks the row and compares. If the hash has moved, the attempt discards its own vectors, leaves
the newer source and the previously published sections untouched, and makes sure exactly one fresh attempt is
queued for the new version — which the edit itself could not do, because its enqueue was deduplicated against
the very attempt that turned out to be stale. The discarded work is logged as superseded, not as a failure,
because nothing went wrong.

Concurrency here is built entirely from what PostgreSQL already gives us: the queue's unique dedupe key, a
conditional claim, `SELECT … FOR UPDATE` in the publish transaction, and the unique constraints on the tables.
No lock service, no advisory locks, nothing to operate.

---

## What the owner sees

One screen, at `/knowledge`. It lists what has been taught, with two buttons to add more — Add text, Add Q&A —
and per row, Edit, Retry and Delete as they apply. A row that is still being processed says "Processing…" and
the list re-reads itself every few seconds until nothing is in flight, so a save completes in front of the
person who made it without them reaching for the browser's reload button. A row that failed shows its one
sentence and a Retry that works. Editing is offered only once a document has settled — an edit mid-processing
is handled correctly, but offering it invites somebody to change something while the row in front of them
cannot show which version is winning.

**The screen does not use our vocabulary, and this is enforced rather than reviewed.**
`tests/unit/knowledge-ui-vocabulary.test.ts` reads every file under `components/knowledge/` and the route
directory and fails on the words we use among ourselves — embedding, vector, chunk, similarity, retrieval,
dimension, batch size, model names — and separately checks the status labels and the five owner-facing failure
sentences, which are the likeliest place for a provider's own words to escape. A new component in that
directory is covered without anybody remembering to add it.

The translation is small and worth knowing: a **section** is a chunk, **Processing…** covers both queued and
claimed, **Couldn't process** is a failed document, and there is no owner-facing word at all for the rest of it,
because none of it is a decision they can make.

Reading requires `knowledge:read`, which every role has. Writing requires `knowledge:create`, `knowledge:update`
or `knowledge:delete`, which owners and managers have and agents and viewers do not. The service layer checks
first, before it does anything else; the UI hiding a button is a courtesy, not the control. Asking for another
workspace's document resolves as not found rather than forbidden, because a forbidden answer confirms the id
exists somewhere.

---

## What it costs

Every batch of embedding calls writes a usage record against the workspace — metric `AI_EMBEDDING_TOKENS`,
marked as estimated, priced from the model catalogue, tagged as knowledge ingestion. Token counts are estimated
from character counts because the provider does not return them for embeddings; the estimate is a division, so a
change to the divisor moves the estimate rather than inverting it.

Two consequences that are easy to get backwards. **Usage is recorded per batch, as each batch returns, and it
survives a later failure** — if the first batch succeeds and the second one fails, the first batch was billed to
us by the provider and stays recorded, because deleting it would make our numbers disagree with the invoice for
a reason nobody would find. And **an attempt that makes no calls records nothing**: a document deleted while its
job waited, or a source rejected before embedding, costs zero rows. Retries do create additional usage, because
they make additional calls.

Ingestion writes no `AI_REQUEST` records. Those describe conversations with a customer, and mixing background
processing into them would make every per-conversation number wrong.

---

## Provenance

Every stored section records which model produced its vector, how wide the vector is, and when it was made. The
chunk is the source of truth for this, not the knowledge base's configured model — that setting says what the
corpus is *meant* to be built with and can be changed under a corpus built with something else, which is
exactly why "does this need re-processing?" is unanswerable without the per-row columns.

The retrieval query relies on it: it filters on the workspace and on the model that produced the query vector,
both inside the SQL. A corpus half re-processed by a new model therefore answers from the half that matches, and
never from a mixture — a distance between vectors from two different models is a number with no meaning, and the
nearest meaningless number is what the assistant would state as fact. `docs/DATABASE.md` covers the index and
the query shape.

---

## Retrieval & Grounding in the AI Turn

During an incoming conversation turn, knowledge retrieval is invoked unless a human handoff was already triggered:
1. **Scope & Provenance**: The query vector is searched against `knowledge_chunks` with `workspaceId`, matching `embeddingModel`, and matching dimension constraints.
2. **Relevance Floor**: Results below `similarityFloor` (0.6) are discarded.
3. **Evidence Budgeting & Deduplication**: Surviving chunks are deduplicated by content, truncated to `maxCharsPerChunk` (1,200 chars), and capped to `evidenceTokenBudget` (800 tokens).
4. **Business Brain & Tool Precedence**: Retrieved text is framed inside `=== RETRIEVED KNOWLEDGE EVIDENCE ===` with explicit instruction on the 4-tier hierarchy: Level 1 live tools (inventory, pricing, orders) and Level 2 structured configuration (operating hours, return policies, shipping fees from Business Brain) take precedence over general Knowledge Base prose.
5. **Absence Handling & Grounding Gate**: If 0 chunks survive, an explicit notice (`=== KNOWLEDGE BASE SEARCH STATUS ===`) instructs the model not to invent or guess policies. Post-generation validation (`validateGrounding`) checks generated replies against Knowledge evidence, Tools, and Business Brain, blocking ungrounded policy commitments (`UNSUPPORTED_POLICY_CLAIM`) and unauthorized discounts (`UNSUPPORTED_DISCOUNT_CLAIM`).

---

## Limits, and what is deliberately absent

The plan's knowledge allowance counts **every** row, whatever its status. A failed document still occupies a
slot, because it is still on the owner's screen and still theirs to fix or delete; excluding failures would let
a broken save be retried into an unlimited number of rows. Creating consumes a slot, deleting releases one, and
editing or retrying an existing document does not consume another.

Not implemented, and not stubs pretending otherwise: file upload of any kind, object storage, PDF or DOCX
parsing, fetching a URL, importing a catalogue as knowledge. Also absent by choice: a way for the owner to
influence how their words are split or which model reads them, because neither is a decision a shop owner has
the information to make, and exposing it would make every one of their support questions about our internals.

Re-processing is all-or-nothing per document — there is no incremental "only this section changed", and an edit
that touches only the title still re-processes the body. The state machine is deliberately that blunt; a
cleverer version would need a reason to trust that the body it did not re-read is still the body it embedded.

---

## Operational notes

Processing needs the worker: `npm run worker`. Without it, saves sit at "Processing…" for ever and nothing is
wrong with the application — this is the first thing to check when a freshly seeded or freshly deployed
environment looks broken.

The log events for one attempt are `knowledge.ingest.queued`, `.started`, `.chunked`, `.embedded`, `.completed`,
and then whichever of `.failed`, `.skipped` or `.superseded` applies, each carrying the workspace, document, job
and attempt so a single save can be followed through a busy log. **None of them contain the source text**, or a
question, or an answer, or a section's contents — an owner's policies are their business, and a log is the
easiest place for that to stop being true.

To diagnose one stuck document: find its status and `failureCode` on the row, then find its job by the dedupe
key of workspace and document id. A `DEAD` job with a document still `FAILED` is the normal end state of three
exhausted attempts and is what Retry is for. A `PROCESSING` document with no live worker is a stalled claim; the
queue reclaims it after its lock timeout, and the screen offers Retry past the same threshold.

The schema arrived in `20260905120000_knowledge_ingestion_v1`, which is additive: the timing, hash and failure
columns on the document, and the uniqueness constraints described in `docs/DATABASE.md`. It also removed a
default on the knowledge base's model column that named a model this product does not use — a default that
would have quietly labelled a corpus with the wrong provenance if anything had ever relied on it.
