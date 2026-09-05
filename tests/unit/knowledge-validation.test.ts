/**
 * The validation boundary for knowledge, where normalisation happens.
 *
 * The normaliser's order is load-bearing and every step is asserted separately, because a
 * reordering does not throw — it silently changes what gets hashed and embedded. The two
 * steps worth the most attention are the ones that look like each other: U+200B is removed
 * and U+200C and U+200D are kept, and a diff that swapped them would break every Urdu
 * document while passing review.
 */

import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_MAX_ANSWER_CHARS,
  KNOWLEDGE_MAX_CONTENT_BYTES,
  KNOWLEDGE_MAX_CONTENT_CHARS,
  KNOWLEDGE_MAX_QUESTION_CHARS,
  KNOWLEDGE_MAX_TITLE_CHARS,
} from '@/config/constants';
import {
  createKnowledgeDocumentSchema,
  knowledgeDocumentRefSchema,
  listKnowledgeDocumentsSchema,
  normalizeKnowledgeLine,
  normalizeKnowledgeText,
  updateKnowledgeDocumentSchema,
  utf8ByteLength,
  KNOWLEDGE_TYPE_LABELS,
  KNOWLEDGE_V1_TYPES,
} from '@/server/validation/knowledge';

const BOM = String.fromCodePoint(0xfeff);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ZWNJ = String.fromCodePoint(0x200c);
const ZWJ = String.fromCodePoint(0x200d);
const RIGHT_TO_LEFT_MARK = String.fromCodePoint(0x200f);
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);

const DOCUMENT_ID = '11111111-2222-4333-8444-555555555555';

/** The first message on a field, so a failing assertion names the field rather than a path. */
function firstError(result: { success: boolean; error?: { issues: readonly { message: string }[] } }): string {
  return result.error?.issues[0]?.message ?? '';
}

describe('normalizeKnowledgeText', () => {
  it('composes to NFC so the same word typed two ways hashes once', () => {
    expect(normalizeKnowledgeText(`a${COMBINING_ACUTE}gay`)).toBe(
      `${String.fromCodePoint(0x00e1)}gay`,
    );
  });

  it('removes a byte order mark left by a paste out of Notepad', () => {
    expect(normalizeKnowledgeText(`${BOM}Delivery Rs. 250`)).toBe('Delivery Rs. 250');
    expect(normalizeKnowledgeText(`Delivery${BOM} Rs. 250`)).toBe('Delivery Rs. 250');
  });

  it('turns every line ending into a single line feed', () => {
    expect(normalizeKnowledgeText('Lahore\r\nKarachi\rIslamabad\nMultan')).toBe(
      'Lahore\nKarachi\nIslamabad\nMultan',
    );
  });

  it('removes the zero-width space, which is only ever residue', () => {
    expect(normalizeKnowledgeText(`Deli${ZERO_WIDTH_SPACE}very`)).toBe('Delivery');
    expect(normalizeKnowledgeText(ZERO_WIDTH_SPACE.repeat(20))).toBe('');
  });

  it('preserves the zero-width non-joiner, which selects a letter form in Urdu', () => {
    const input = `دو${ZWNJ}تین دن`;

    expect(normalizeKnowledgeText(input)).toBe(input);
    expect(normalizeKnowledgeText(input)).toContain(ZWNJ);
  });

  it('preserves the zero-width joiner, which binds an emoji together', () => {
    const family = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(ZWJ);

    expect(normalizeKnowledgeText(`Family pack ${family}`)).toBe(`Family pack ${family}`);
  });

  it('preserves bidi marks, which decide the order of a mixed line', () => {
    const mixed = `${RIGHT_TO_LEFT_MARK}قیمت Rs. 250${LEFT_TO_RIGHT_MARK} ہے`;

    expect(normalizeKnowledgeText(mixed)).toBe(mixed);
  });

  it('collapses runs of spaces and tabs to one space', () => {
    expect(normalizeKnowledgeText('Delivery      charges\t\tRs. 250')).toBe(
      'Delivery charges Rs. 250',
    );
  });

  it('strips trailing whitespace before counting a line as blank', () => {
    // Order matters: a line holding one space would otherwise defeat the blank-line
    // collapse below it and leave two paragraph breaks where the owner made one.
    expect(normalizeKnowledgeText('Delivery\n   \n\nExchange')).toBe('Delivery\n\nExchange');
  });

  it('collapses a run of blank lines to a single paragraph break', () => {
    expect(normalizeKnowledgeText('Delivery\n\n\n\n\nExchange')).toBe('Delivery\n\nExchange');
    expect(normalizeKnowledgeText('Delivery\n\nExchange')).toBe('Delivery\n\nExchange');
  });

  it('trims the whole document', () => {
    expect(normalizeKnowledgeText('\n\n  Delivery Rs. 250  \n\n')).toBe('Delivery Rs. 250');
  });

  it('changes nothing else — no lowercasing, no transliteration, no punctuation stripping', () => {
    const source = 'COD available hai! Rs. 3,499 (XL) — 100% cotton؟ ڈیلیوری فری۔';

    expect(normalizeKnowledgeText(source)).toBe(source);
  });

  it('is idempotent, so re-saving a document cannot drift', () => {
    const once = normalizeKnowledgeText('\r\n Delivery\t\tRs. 250 \n\n\n\nExchange 7 din \n');

    expect(normalizeKnowledgeText(once)).toBe(once);
  });
});

describe('normalizeKnowledgeLine', () => {
  it('turns a pasted line break into a space rather than joining two words', () => {
    expect(normalizeKnowledgeLine('Delivery\ncharges')).toBe('Delivery charges');
    expect(normalizeKnowledgeLine('Delivery\n\n\ncharges')).toBe('Delivery charges');
  });

  it('leaves a single-line title alone', () => {
    expect(normalizeKnowledgeLine('  Delivery and charges  ')).toBe('Delivery and charges');
  });
});

describe('utf8ByteLength', () => {
  it('counts bytes, not code units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('ڈ')).toBe(2);
    expect(utf8ByteLength(String.fromCodePoint(0x1f600))).toBe(4);
  });
});

describe('what a knowledge document may be', () => {
  it('offers only text and a question and answer in v1', () => {
    expect(KNOWLEDGE_V1_TYPES).toEqual(['TEXT', 'FAQ']);
    expect(KNOWLEDGE_TYPE_LABELS.FAQ).toBe('Q&A');
  });

  it('accepts a piece of text and stores it normalised', () => {
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: '  Delivery   information  ',
      content: 'Lahore\r\nKarachi\n\n\n\nRs. 250 charges hain.',
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== 'TEXT') throw new Error('expected text');
    expect(result.data.title).toBe('Delivery information');
    expect(result.data.content).toBe('Lahore\nKarachi\n\nRs. 250 charges hain.');
  });

  it('accepts a question and answer and flattens the question to one line', () => {
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'FAQ',
      title: 'Exchange policy',
      question: 'Exchange\nkitne din mein?',
      answer: 'Saat din ke andar.',
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== 'FAQ') throw new Error('expected a Q&A');
    expect(result.data.question).toBe('Exchange kitne din mein?');
  });

  it('refuses a deferred type with one sentence about what is available', () => {
    for (const type of ['PDF', 'DOCX', 'URL', 'CATALOG', 'POLICY']) {
      const result = createKnowledgeDocumentSchema.safeParse({
        type,
        title: 'Catalogue',
        content: 'Anything',
      });

      expect(result.success).toBe(false);
      expect(firstError(result)).toContain('text or a question and answer');
    }
  });

  it('refuses an unexpected field rather than silently ignoring it', () => {
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: 'Delivery',
      content: 'Rs. 250',
      sourceUrl: 'https://example.test/policy',
    });

    expect(result.success).toBe(false);
  });

  it('refuses a submission that is empty only after normalisation', () => {
    for (const content of ['', '   ', '\n\n\n', ZERO_WIDTH_SPACE.repeat(5), BOM]) {
      const result = createKnowledgeDocumentSchema.safeParse({
        type: 'TEXT',
        title: 'Delivery',
        content,
      });

      expect(result.success).toBe(false);
      expect(firstError(result)).toContain('Write what you want');
    }
  });

  it('refuses a missing title with words a shop owner can act on', () => {
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: '   ',
      content: 'Rs. 250',
    });

    expect(result.success).toBe(false);
    expect(firstError(result)).toContain('Give this a name');
  });

  it('measures every limit after normalisation, not before', () => {
    // Sixty thousand characters of blank lines is a short document once collapsed, and
    // refusing it for a length it does not have would send the owner editing nothing.
    const padded = `Delivery Rs. 250${'\n\n\n'.repeat(20_000)}`;
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: 'Delivery',
      content: padded,
    });

    expect(padded.length).toBeGreaterThan(KNOWLEDGE_MAX_CONTENT_CHARS);
    expect(result.success).toBe(true);
  });

  it('refuses text past the character limit', () => {
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: 'Delivery',
      content: 'x'.repeat(KNOWLEDGE_MAX_CONTENT_CHARS + 1),
    });

    expect(result.success).toBe(false);
    expect(firstError(result)).toContain('Split it into a few shorter pieces');
  });

  it('bounds the stored size in bytes as well as characters', () => {
    // The two caps bound different things: `String.length` counts UTF-16 code units and the
    // byte cap counts what Postgres stores. The worst ratio is three bytes to one code unit
    // — a character in U+0800..U+FFFF — so at today's numbers the character cap already
    // implies at most 150,000 bytes and the byte cap is headroom for it being raised rather
    // than a second gate a submission trips. Asserted as a relationship so that raising the
    // character cap without revisiting the byte cap fails here instead of in production.
    const threeBytesOneCodeUnit = String.fromCodePoint(0x0e01);
    const worstCase = threeBytesOneCodeUnit.repeat(KNOWLEDGE_MAX_CONTENT_CHARS);

    expect(worstCase).toHaveLength(KNOWLEDGE_MAX_CONTENT_CHARS);
    expect(utf8ByteLength(worstCase)).toBe(KNOWLEDGE_MAX_CONTENT_CHARS * 3);
    expect(KNOWLEDGE_MAX_CONTENT_BYTES).toBeGreaterThanOrEqual(KNOWLEDGE_MAX_CONTENT_CHARS * 3);
  });

  it('accepts Urdu and emoji, which cost more room than English', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const result = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: 'ڈیلیوری کی معلومات',
      content: `ڈیلیوری دو سے تین دن میں ہو جاتی ہے۔ COD available hai ${emoji}\n`.repeat(500),
    });

    expect(result.success).toBe(true);
  });

  it('bounds the title, the question and the answer', () => {
    const tooLongTitle = createKnowledgeDocumentSchema.safeParse({
      type: 'TEXT',
      title: 'x'.repeat(KNOWLEDGE_MAX_TITLE_CHARS + 1),
      content: 'Rs. 250',
    });
    const tooLongQuestion = createKnowledgeDocumentSchema.safeParse({
      type: 'FAQ',
      title: 'Exchange',
      question: 'x'.repeat(KNOWLEDGE_MAX_QUESTION_CHARS + 1),
      answer: 'Saat din.',
    });
    const tooLongAnswer = createKnowledgeDocumentSchema.safeParse({
      type: 'FAQ',
      title: 'Exchange',
      question: 'Kitne din?',
      answer: 'x'.repeat(KNOWLEDGE_MAX_ANSWER_CHARS + 1),
    });

    expect(tooLongTitle.success).toBe(false);
    expect(tooLongQuestion.success).toBe(false);
    expect(tooLongAnswer.success).toBe(false);
  });
});

describe('editing and referencing a document', () => {
  it('requires the document id and the unchanged type', () => {
    const result = updateKnowledgeDocumentSchema.safeParse({
      documentId: DOCUMENT_ID,
      type: 'TEXT',
      title: 'Delivery',
      content: 'Rs. 250 charges hain.',
    });

    expect(result.success).toBe(true);
  });

  it('refuses an id that is not a uuid', () => {
    for (const documentId of ['', 'not-a-uuid', '1', DOCUMENT_ID.slice(0, -1)]) {
      expect(knowledgeDocumentRefSchema.safeParse({ documentId }).success).toBe(false);
    }
  });

  it('accepts a reference to one row and nothing else', () => {
    expect(knowledgeDocumentRefSchema.safeParse({ documentId: DOCUMENT_ID }).success).toBe(true);
    expect(
      knowledgeDocumentRefSchema.safeParse({ documentId: DOCUMENT_ID, workspaceId: DOCUMENT_ID })
        .success,
    ).toBe(false);
  });

  it('defaults the page size and refuses an unbounded one', () => {
    const defaulted = listKnowledgeDocumentsSchema.safeParse({});

    expect(defaulted.success).toBe(true);
    if (!defaulted.success) throw new Error('expected a default');
    expect(defaulted.data.limit).toBeGreaterThan(0);
    expect(listKnowledgeDocumentsSchema.safeParse({ limit: 10_000 }).success).toBe(false);
  });
});
