/**
 * The fingerprint behind the duplicate constraint.
 *
 * `knowledge_documents` carries a unique index on `(workspaceId, contentHash)`, so whatever
 * this function returns is what the database will and will not accept a second copy of. Two
 * properties matter and neither is obvious from reading the implementation: identical source
 * must produce an identical hash on every process (or the constraint stops catching
 * duplicates at all), and source that differs only in where one field ends must produce a
 * different one (or the constraint starts rejecting documents that are not duplicates).
 */

import { describe, expect, it } from 'vitest';

import { knowledgeContentHash } from '@/server/services/knowledge/content-hash';

const TEXT = {
  type: 'TEXT',
  title: 'Delivery information',
  content: 'Delivery is Rs. 250 nationwide and takes 2-3 days in Lahore.',
} as const;

const FAQ = {
  type: 'FAQ',
  title: 'Cash on delivery',
  question: 'Do you offer COD?',
  answer: 'Jee bilkul, cash on delivery is available across Pakistan.',
} as const;

describe('knowledgeContentHash', () => {
  it('is a sha-256 digest in lowercase hex', () => {
    expect(knowledgeContentHash(TEXT)).toMatch(/^[0-9a-f]{64}$/);
    expect(knowledgeContentHash(FAQ)).toMatch(/^[0-9a-f]{64}$/);
  });

  // The constraint is only a duplicate check if the same words always land on the same value.
  it('is deterministic for the same source', () => {
    expect(knowledgeContentHash(TEXT)).toBe(knowledgeContentHash({ ...TEXT }));
    expect(knowledgeContentHash(FAQ)).toBe(knowledgeContentHash({ ...FAQ }));
  });

  it('changes when any covered field changes', () => {
    const base = knowledgeContentHash(TEXT);

    expect(knowledgeContentHash({ ...TEXT, title: 'Delivery info' })).not.toBe(base);
    expect(knowledgeContentHash({ ...TEXT, content: `${TEXT.content} COD available.` })).not.toBe(
      base,
    );
  });

  it('distinguishes a question from its answer', () => {
    const swapped = knowledgeContentHash({
      ...FAQ,
      question: FAQ.answer,
      answer: FAQ.question,
    });

    expect(swapped).not.toBe(knowledgeContentHash(FAQ));
  });

  // A Q&A whose question and answer happen to concatenate to the same characters as a piece
  // of text is not the same document, and one of the two would otherwise be refused.
  it('separates the two kinds of knowledge', () => {
    const asText = knowledgeContentHash({
      type: 'TEXT',
      title: 'Cash on delivery',
      content: 'Do you offer COD?Jee bilkul, cash on delivery is available across Pakistan.',
    });

    expect(asText).not.toBe(knowledgeContentHash(FAQ));
  });

  // The reason each field is length-prefixed. Concatenating fields with a separator lets a
  // title that contains the separator borrow characters from the field after it, and the two
  // documents below would collide — the second one unsavable for a reason nobody could see.
  it('does not let one field bleed into the next', () => {
    const bleeding = knowledgeContentHash({
      type: 'TEXT',
      title: 'Delivery|Rs. 250',
      content: '',
    });
    const honest = knowledgeContentHash({
      type: 'TEXT',
      title: 'Delivery',
      content: 'Rs. 250',
    });

    expect(bleeding).not.toBe(honest);
  });

  it('distinguishes an empty trailing field from a missing one', () => {
    const emptyAnswer = knowledgeContentHash({
      type: 'FAQ',
      title: 'Exchanges',
      question: 'Can I exchange?',
      answer: '',
    });
    const emptyQuestion = knowledgeContentHash({
      type: 'FAQ',
      title: 'Exchanges',
      question: '',
      answer: 'Can I exchange?',
    });

    expect(emptyAnswer).not.toBe(emptyQuestion);
  });
});
