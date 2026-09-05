/**
 * Validation for the knowledge a business teaches its assistant.
 *
 * The same schemas back the dialogs and the server actions, so the browser and the
 * server cannot disagree about what a valid document is.
 *
 * Two things happen here that are more than checking.
 *
 * **Normalisation is part of validation.** `normalizeKnowledgeText` runs inside the
 * schema, so the text that is stored, the text the duplicate hash is taken over and the
 * text the chunker cuts are one string. Were it done further downstream, the stored
 * source and the embedded text would differ and the hash would be taken over something
 * the owner cannot see — two documents identical on screen would hash differently and
 * both would consume a slot.
 *
 * **Limits are checked after normalisation.** Sixty thousand characters that are mostly
 * repeated blank lines is a forty-thousand-character document once collapsed, and
 * refusing it for a length it does not have is a lie. The byte cap needs the same order:
 * it bounds the UTF-8 size of the text as stored.
 *
 * No `server-only` here, like every other file in this directory — the forms import
 * these schemas. Nothing in this file reads a database, a secret or the environment.
 */

import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  KNOWLEDGE_MAX_ANSWER_CHARS,
  KNOWLEDGE_MAX_CONTENT_BYTES,
  KNOWLEDGE_MAX_CONTENT_CHARS,
  KNOWLEDGE_MAX_QUESTION_CHARS,
  KNOWLEDGE_MAX_TITLE_CHARS,
  MAX_PAGE_SIZE,
} from '@/config/constants';

/**
 * What a business may add today.
 *
 * `KnowledgeType` in the database also holds PDF, DOCX, URL, CATALOG and POLICY. Those
 * are deferred, not supported: nothing parses a PDF and nothing fetches a URL, so a
 * document of one of those types would sit unprocessed for ever. They stay in the
 * database enum — dropping a value from a Postgres enum is a migration nobody needs —
 * and are refused here, which is the only place a caller can introduce one.
 */
export const KNOWLEDGE_V1_TYPES = ['TEXT', 'FAQ'] as const;
export type KnowledgeV1Type = (typeof KNOWLEDGE_V1_TYPES)[number];

/** What each type is called on screen. The words a shop owner reads, in one place. */
export const KNOWLEDGE_TYPE_LABELS: Record<KnowledgeV1Type, string> = {
  TEXT: 'Text',
  FAQ: 'Q&A',
};

/**
 * The label for a stored type, whatever it turns out to be.
 *
 * A table renders whatever the column holds, and the column is a database enum with five
 * values V1 has no label for. Reaching into `KNOWLEDGE_TYPE_LABELS` with a cast would
 * render `undefined` in a cell; asserting the value is a V1 type would be a lie the
 * compiler cannot catch. The fallback is a plain noun that reads correctly for anything.
 */
export function knowledgeTypeLabel(type: string): string {
  const known = KNOWLEDGE_V1_TYPES.find((candidate) => candidate === type);
  return known ? KNOWLEDGE_TYPE_LABELS[known] : 'Document';
}

/**
 * Where a document is in processing, and the words a shop owner reads for it.
 *
 * Declared here rather than imported from `@prisma/client` for the reason every other
 * status union in `server/validation` is: the badges that render these are client
 * components, and a client bundle has no business importing the database client. The
 * literals are the same four `IngestStatus` holds, so a value added to the enum without a
 * label here fails to compile at every call site rather than rendering `undefined`.
 *
 * `PENDING` and `PROCESSING` deliberately share one label. The difference between them is
 * "waiting for a worker" and "in a worker" — a distinction about our queue, not about the
 * owner's return policy, and one they can neither act on nor verify. Two words for one
 * observable state would only invite the question of which is worse.
 */
export const KNOWLEDGE_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  PENDING: 'Processing…',
  PROCESSING: 'Processing…',
  READY: 'Ready',
  FAILED: 'Couldn’t process',
};

/** Whether processing is still expected to finish on its own. Drives whether the list keeps
 *  re-reading itself and whether editing is offered. */
export function isKnowledgeInFlight(status: KnowledgeStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

/** The same limits the schemas enforce, exported for the forms' `maxLength`, for the
 *  reason documented on `CONTACT_FIELD_MAX`: an attribute that disagrees with the
 *  server stops accepting keystrokes at a length the server would have allowed, and
 *  the person cannot tell why. */
export const KNOWLEDGE_FIELD_MAX = {
  title: KNOWLEDGE_MAX_TITLE_CHARS,
  content: KNOWLEDGE_MAX_CONTENT_CHARS,
  question: KNOWLEDGE_MAX_QUESTION_CHARS,
  answer: KNOWLEDGE_MAX_ANSWER_CHARS,
} as const;

/** UTF-8 is what Postgres stores and what the byte cap is written in. */
const UTF8 = new TextEncoder();

/**
 * The code points removed by step 4 of the normaliser below, built from their numbers
 * rather than pasted into a regex literal.
 *
 * An invisible character inside a pattern is unreviewable: nobody can tell U+200B from
 * U+200C by looking at it, and a diff that swapped one for the other would silently
 * break every Urdu document while passing review. The numbers say which is which.
 */
const BYTE_ORDER_MARK = new RegExp(String.fromCodePoint(0xfeff), 'g');
const ZERO_WIDTH_SPACE = new RegExp(String.fromCodePoint(0x200b), 'g');

/**
 * UTF-8 byte length.
 *
 * `String.length` counts UTF-16 code units, which is a different number from bytes for
 * everything outside ASCII: an Urdu letter costs two bytes, an emoji four. The two caps
 * therefore bound different things and neither implies the other.
 */
export function utf8ByteLength(text: string): number {
  return UTF8.encode(text).length;
}

/**
 * The one normaliser for every knowledge source field.
 *
 * The order is load-bearing and each step earns its place.
 *
 * 1. **NFC first**, so everything after it sees one representation per character. An
 *    Urdu word typed as a composed form and the same word typed as base plus combining
 *    mark must hash identically, or the duplicate constraint stops working outside
 *    English.
 * 2. **The byte order mark** leads a paste out of Notepad: invisible, counted by every
 *    length check, and enough on its own to make two identical documents hash apart.
 * 3. **One line ending**, so the chunker's separator ladder has one thing to look for
 *    and no chunk ends in a stray carriage return.
 * 4. **U+200B zero-width space** is removed. It is invisible, carries no meaning, and is
 *    the usual residue of copying out of a web page.
 * 5. **U+200C zero-width non-joiner is preserved.**
 * 6. **U+200D zero-width joiner is preserved.** Neither is decoration in Urdu, Persian
 *    or Arabic — they select a letter's joining form, and stripping them changes the
 *    word. This is exactly why step 4 names one code point instead of a "zero-width"
 *    character class, which would have taken all three.
 * 7. **Bidi marks are preserved**, for the same reason: they decide the visual order of
 *    a mixed line like "Delivery Rs. 250 ہے".
 * 8. **Runs of spaces and tabs collapse to one space.** Indentation pasted out of a
 *    document is not information here, and forty spaces is forty characters of the
 *    owner's content allowance.
 * 9. **Trailing whitespace goes before blank lines are counted**, so a line holding
 *    nothing but a space counts as blank in step 10 rather than defeating it.
 * 10. **Runs of blank lines collapse to one.** A paragraph break is a chunk boundary,
 *     and six of them in a row is still one boundary.
 * 11. **The document's own edges are trimmed.**
 *
 * Deliberately absent: no lowercasing, no transliteration, no punctuation stripping. The
 * stored text is shown back to the owner and quoted to their customer, so it has to
 * survive as they wrote it. Case folding is a property of matching, not of storage.
 */
export function normalizeKnowledgeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(BYTE_ORDER_MARK, '')
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH_SPACE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A single-line field: a title, or the question half of a Q&A.
 *
 * A title is rendered in one row of a table, and a question becomes the `Q:` line of
 * every piece its answer is cut into — a newline inside it would break that shape apart.
 * Line breaks become spaces rather than vanishing, so two pasted lines do not run
 * together into one word.
 */
export function normalizeKnowledgeLine(input: string): string {
  return normalizeKnowledgeText(input).replace(/\s*\n+\s*/g, ' ');
}

/**
 * A required source field: normalised first, then bounded.
 *
 * Emptiness is checked after normalisation, which is the only way to catch a submission
 * that is one zero-width space or three blank lines. Such a submission has a length
 * before normalisation and none after, and left alone it reaches the chunker, produces
 * no pieces, and fails permanently with a reason the owner cannot act on.
 */
function sourceField(
  normalise: (value: string) => string,
  max: number,
  messages: { readonly missing: string; readonly tooLong: string },
) {
  return z
    .string({ required_error: messages.missing, invalid_type_error: messages.missing })
    .transform(normalise)
    .refine((value) => value.length > 0, { message: messages.missing })
    .refine((value) => value.length <= max, { message: messages.tooLong });
}

/** Thousands separators, because "50000" in an error message is read as a typo. */
function grouped(value: number): string {
  return value.toLocaleString('en-US');
}

const knowledgeTitle = sourceField(normalizeKnowledgeLine, KNOWLEDGE_MAX_TITLE_CHARS, {
  missing: 'Give this a name so you can find it later.',
  tooLong: `Use a name shorter than ${grouped(KNOWLEDGE_MAX_TITLE_CHARS)} characters.`,
});

const knowledgeContent = sourceField(normalizeKnowledgeText, KNOWLEDGE_MAX_CONTENT_CHARS, {
  missing: 'Write what you want your assistant to know.',
  tooLong: `That is longer than ${grouped(KNOWLEDGE_MAX_CONTENT_CHARS)} characters. Split it into a few shorter pieces — shorter pieces are also answered more accurately.`,
}).refine((value) => utf8ByteLength(value) <= KNOWLEDGE_MAX_CONTENT_BYTES, {
  // The character cap does not imply this one. Fifty thousand characters of English is
  // 50kB, of Urdu 100kB and of emoji 200kB, so a submission comfortably inside the
  // character limit can still be four times the size it was budgeted for.
  message:
    'That is too large to save. Urdu and emoji take up more room than English, so split it into a few shorter pieces.',
});

const knowledgeQuestion = sourceField(normalizeKnowledgeLine, KNOWLEDGE_MAX_QUESTION_CHARS, {
  missing: 'Write the question a customer would ask.',
  tooLong:
    'Ask this as a shorter question. A long one matches fewer of the ways customers actually phrase it.',
});

const knowledgeAnswer = sourceField(normalizeKnowledgeText, KNOWLEDGE_MAX_ANSWER_CHARS, {
  missing: 'Write the answer your assistant should give.',
  tooLong: `Keep the answer under ${grouped(KNOWLEDGE_MAX_ANSWER_CHARS)} characters, or add it as text instead.`,
});

export const knowledgeDocumentId = z.string().uuid('That knowledge reference is not valid.');

const UNSUPPORTED_TYPE_MESSAGE =
  'You can add text or a question and answer. Other kinds of knowledge are not available yet.';

const textPayload = z
  .object({ type: z.literal('TEXT'), title: knowledgeTitle, content: knowledgeContent })
  .strict();

const faqPayload = z
  .object({
    type: z.literal('FAQ'),
    title: knowledgeTitle,
    question: knowledgeQuestion,
    answer: knowledgeAnswer,
  })
  .strict();

/**
 * What a new knowledge document may be.
 *
 * `.strict()` rather than the default strip, because an unexpected field means a caller
 * disagrees with the server about what a document is — a form still posting `url` after
 * the URL type was deferred, say. Stripping it would accept the submission and silently
 * ignore half of what was sent.
 *
 * The union is discriminated rather than a plain `z.union` so a bad title on a piece of
 * text reports one error about the title instead of two errors about two shapes the
 * submission failed to be. The `errorMap` is reached only for the discriminator itself,
 * which is where a deferred type lands; the field messages come from the fields.
 */
export const createKnowledgeDocumentSchema = z.discriminatedUnion(
  'type',
  [textPayload, faqPayload],
  { errorMap: () => ({ message: UNSUPPORTED_TYPE_MESSAGE }) },
);
export type CreateKnowledgeDocumentInput = z.infer<typeof createKnowledgeDocumentSchema>;

/**
 * An edit carries the whole document rather than a patch, because the dialogs are full
 * forms and a partial update would leave the stored hash and the stored pieces
 * describing text that is no longer there.
 *
 * `type` is present and immutable. Turning text into a Q&A would leave `content`
 * populated on a row nothing reads it from; the service compares this against the stored
 * type and refuses the change rather than half-migrating the row.
 */
export const updateKnowledgeDocumentSchema = z.discriminatedUnion(
  'type',
  [
    textPayload.extend({ documentId: knowledgeDocumentId }),
    faqPayload.extend({ documentId: knowledgeDocumentId }),
  ],
  { errorMap: () => ({ message: UNSUPPORTED_TYPE_MESSAGE }) },
);
export type UpdateKnowledgeDocumentInput = z.infer<typeof updateKnowledgeDocumentSchema>;

/**
 * The stored source an edit dialog reopens.
 *
 * Deliberately the update schema's own output type rather than a hand-written twin. What the
 * dialog is filled with and what it posts back are the same set of fields, so tying them to
 * one definition means a field added to the schema cannot be forgotten in the prefill — and a
 * forgotten prefill does not fail to compile, it silently blanks that field on save.
 *
 * Client-safe, like everything in this file: the dialog is a client component and the loader
 * that fills it is a server action, so the shape has to be importable from both sides.
 */
export type KnowledgeDocumentSource = UpdateKnowledgeDocumentInput;

/** Delete and Retry need nothing but the row they act on. */
export const knowledgeDocumentRefSchema = z.object({ documentId: knowledgeDocumentId }).strict();
export type KnowledgeDocumentRef = z.infer<typeof knowledgeDocumentRefSchema>;

/**
 * Cursor pagination, for the reason documented on `listProductsSchema`. The top plan's
 * document allowance is unlimited, so an unbounded read is a page that gets slower for
 * exactly the customers using the feature most.
 */
export const listKnowledgeDocumentsSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListKnowledgeDocumentsInput = z.infer<typeof listKnowledgeDocumentsSchema>;
