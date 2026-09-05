/**
 * The chunker's contract, tested where it is load-bearing.
 *
 * Two groups of assertion carry most of the weight. The **invariants** — every piece within
 * the ceiling, positions dense from zero, never zero pieces, byte-identical output for
 * identical input — hold for every input in this file and are asserted through one helper
 * rather than restated per case. The **boundary-safety** cases are the ones that would
 * otherwise fail silently: a split surrogate pair or a stripped joiner does not throw, it
 * just stores text that is not what the owner wrote.
 */

import { describe, expect, it } from 'vitest';

import {
  APPROX_CHARS_PER_TOKEN,
  KNOWLEDGE_CHUNKING,
  KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT,
  KNOWLEDGE_RETRIEVAL,
} from '@/config/constants';
import {
  chunkKnowledgeSource,
  estimateTokens,
  type ChunkSource,
  type KnowledgeChunkDraft,
} from '@/server/services/knowledge/chunker';
import { KnowledgeIngestFailure } from '@/server/services/knowledge/errors';
import { normalizeKnowledgeText } from '@/server/validation/knowledge';

const ZWNJ = String.fromCodePoint(0x200c);
const ZWJ = String.fromCodePoint(0x200d);
const URDU_FULL_STOP = String.fromCodePoint(0x06d4);
const RIGHT_TO_LEFT_MARK = String.fromCodePoint(0x200f);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);

/**
 * Emoji built from code points rather than pasted in, so a reviewer can see how many code
 * units each one costs — which is the whole subject of the boundary tests below.
 */
const GRINNING = String.fromCodePoint(0x1f600); // 2 code units
const FLAG_PAKISTAN = String.fromCodePoint(0x1f1f5, 0x1f1f0); // 4: two regional indicators
const THUMBS_UP = String.fromCodePoint(0x1f44d, 0x1f3fd); // 4: emoji plus skin tone
const FAMILY = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(ZWJ); // 8

/** Cuts every invariant that must hold for every source, so no case has to restate them. */
function chunk(source: ChunkSource): KnowledgeChunkDraft[] {
  const chunks = chunkKnowledgeSource(source);

  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.map((piece) => piece.position)).toEqual(chunks.map((_, index) => index));

  for (const piece of chunks) {
    expect(piece.content.length).toBeLessThanOrEqual(KNOWLEDGE_CHUNKING.maxChars);
    expect(piece.content).toBe(piece.content.trim());
    expect(piece.content.length).toBeGreaterThan(0);
    expect(hasLoneSurrogate(piece.content)).toBe(false);
    expect(piece.tokenCount).toBe(Math.ceil(piece.content.length / APPROX_CHARS_PER_TOKEN));
  }

  // Determinism is what makes re-ingestion safe, so it is checked on every input rather
  // than in one case that a future edit could leave behind.
  expect(chunkKnowledgeSource(source)).toEqual(chunks);

  return chunks;
}

/** True when a surrogate survives that is not part of a pair — the signature of a bad cut. */
function hasLoneSurrogate(text: string): boolean {
  return /[\uD800-\uDFFF]/.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''));
}

function text(content: string): ChunkSource {
  return { type: 'TEXT', content };
}

function faq(question: string, answer: string): ChunkSource {
  return { type: 'FAQ', question, answer };
}

/**
 * `count` sentences of realistic Roman Urdu shop copy, space separated and each exactly
 * seventy-five characters, so a test can say where a boundary must land.
 */
function sentences(count: number, seed: string): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${seed} ${index + 1} order confirm hone ke baad 2 se 3 din mein delivery ho jati hai.`,
  ).join(' ');
}

/** A run with no separator of any kind in it — the case the ladder cannot help with. */
function unbreakable(chars: number): string {
  return 'x'.repeat(chars);
}

describe('configuration the chunker depends on', () => {
  it('caps a chunk at exactly what retrieval will show', () => {
    // Wired to one value in configuration; asserted here because a chunk longer than this
    // would be text that can never be retrieved whole, and the two constants living in
    // different sections is how that drifts.
    expect(KNOWLEDGE_CHUNKING.maxChars).toBe(KNOWLEDGE_RETRIEVAL.maxCharsPerChunk);
  });

  it('leaves room for an overlap inside the target', () => {
    expect(KNOWLEDGE_CHUNKING.overlapChars).toBeLessThan(KNOWLEDGE_CHUNKING.targetChars);
    expect(KNOWLEDGE_CHUNKING.minChars).toBeLessThan(KNOWLEDGE_CHUNKING.targetChars);
    expect(KNOWLEDGE_CHUNKING.targetChars).toBeLessThanOrEqual(KNOWLEDGE_CHUNKING.maxChars);
  });
});

describe('estimateTokens', () => {
  it('divides characters by the ratio rather than multiplying', () => {
    expect(estimateTokens('a'.repeat(900))).toBe(225);
    expect(estimateTokens('a'.repeat(4))).toBe(1);
  });

  it('rounds up, because nothing costs zero tokens', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('a'.repeat(5))).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('sources with nothing in them', () => {
  it('refuses an empty document permanently', () => {
    expect(() => chunkKnowledgeSource(text(''))).toThrow(KnowledgeIngestFailure);
    expect(() => chunkKnowledgeSource(text(''))).toThrow(
      expect.objectContaining({ failureCode: 'CONTENT_EMPTY' }),
    );
  });

  it('refuses whitespace that survived as far as the chunker', () => {
    expect(() => chunkKnowledgeSource(text('   \n\n  \t '))).toThrow(
      expect.objectContaining({ failureCode: 'CONTENT_EMPTY' }),
    );
  });

  it('is never reached for a zero-width submission, because normalisation empties it', () => {
    expect(normalizeKnowledgeText(String.fromCodePoint(0x200b).repeat(20))).toBe('');
  });
});

describe('text short enough to stay whole', () => {
  it('becomes exactly one chunk, unchanged', () => {
    const content = 'Delivery charges Rs. 250 hain. Lahore aur Karachi mein 2 din lagte hain.';
    const chunks = chunk(text(content));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(content);
  });

  it('keeps a document sitting exactly on the ceiling whole', () => {
    expect(chunk(text(unbreakable(KNOWLEDGE_CHUNKING.maxChars)))).toHaveLength(1);
  });

  it('splits a document one character past the ceiling', () => {
    expect(chunk(text(unbreakable(KNOWLEDGE_CHUNKING.maxChars + 1))).length).toBeGreaterThan(1);
  });
});

describe('where text is cut', () => {
  it('prefers a paragraph break over anything else in the window', () => {
    // Each paragraph is 683 characters, so the break sits inside the window and well short
    // of the 900-character target. A ladder that ignored priority would cut at one of the
    // sentence ends nearer 900 instead, part-way into the first paragraph.
    const delivery = sentences(9, 'Delivery');
    const exchange = sentences(9, 'Exchange');
    const chunks = chunk(text(`${delivery}\n\n${exchange}\n\n${sentences(9, 'Refund')}`));

    expect(chunks[0]?.content).toBe(delivery);
  });

  it('falls to a line break when there is no blank line', () => {
    const cities = Array.from(
      { length: 40 },
      (_, index) => `Shehr ${index + 1}: delivery charge Rs. ${250 + index * 10} hai.`,
    ).join('\n');
    const chunks = chunk(text(cities));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.content.startsWith('Shehr 1:')).toBe(true);
    // Every piece ends where a line ends. Pieces after the first may *begin* mid-line,
    // because the overlap deliberately reaches back into the previous piece.
    for (const piece of chunks) {
      expect(piece.content.endsWith('hai.')).toBe(true);
    }
  });

  it('cuts a wall of prose at a sentence end', () => {
    const chunks = chunk(text(sentences(40, 'Return')));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks.slice(0, -1)) {
      expect(piece.content.endsWith('.')).toBe(true);
    }
  });

  it('treats an Urdu full stop as a sentence end', () => {
    const sentence = `ڈیلیوری دو سے تین دن میں ہو جاتی ہے${URDU_FULL_STOP} `;
    const chunks = chunk(text(sentence.repeat(80).trim()));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks.slice(0, -1)) {
      expect(piece.content.endsWith(URDU_FULL_STOP)).toBe(true);
    }
  });

  it('keeps a price out of the middle of a boundary', () => {
    // "Rs. 3,499" contains a full stop followed by a space, and the decimal in "8.5" does
    // not. Neither may end a piece part-way through the number it belongs to.
    const chunks = chunk(text(`${'Size 8.5 ka price Rs. 3,499 hai aur stock mein hai. '.repeat(60).trim()}`));

    for (const piece of chunks) {
      expect(piece.content).not.toMatch(/8$/);
      expect(piece.content).not.toMatch(/^5 /);
    }
  });

  it('cuts at a word boundary when a single sentence runs past the ceiling', () => {
    const vocabulary = ['kameez', 'shalwar', 'dupatta', 'lawn', 'cotton', 'silk'];
    const chunks = chunk(text(`${`${vocabulary.join(' ')} `.repeat(80).trim()}.`));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      expect(vocabulary).toContain(piece.content.split(' ')[0]);
    }
  });

  it('cuts a run with no separator at all at the ceiling', () => {
    const chunks = chunk(text(unbreakable(3_000)));

    expect(chunks[0]?.content).toHaveLength(KNOWLEDGE_CHUNKING.maxChars);
  });
});

describe('what one chunk carries of the one before it', () => {
  it('opens every chunk with text the previous one ended on', () => {
    const chunks = chunk(text(sentences(40, 'Return')));
    // Half the overlap: comfortably inside what is carried, whatever the ladder chose, so
    // the assertion tests that an overlap exists rather than its exact width.
    const shared = Math.floor(KNOWLEDGE_CHUNKING.overlapChars / 2);

    expect(chunks.length).toBeGreaterThan(2);
    for (let index = 1; index < chunks.length; index += 1) {
      const opening = chunks[index]?.content.slice(0, shared) ?? '';
      expect(chunks[index - 1]?.content).toContain(opening);
    }
  });

  it('never opens a chunk in the middle of a word', () => {
    const chunks = chunk(text(sentences(40, 'Exchange')));

    for (const piece of chunks.slice(1)) {
      // Every sentence in the fixture begins with the seed word, and every other word in
      // it is one a reader would recognise — an opening like "hange 7 order" would mean
      // the overlap had been measured in characters and left there.
      expect(piece.content).toMatch(/^[A-Za-z0-9]/);
      expect(piece.content.split(' ')[0]).not.toMatch(/^(?:xchange|hange|ange)$/);
    }
  });

  it('grows a final fragment instead of emitting it alone', () => {
    // Contrived to reach the one case that produces a fragment: the line break is the only
    // cut in the first window, and the only space sits two characters before it, so the
    // overlap snaps forward to within two characters of the cut and leaves a nine-character
    // remainder rather than the usual hundred and fifty.
    const tail = 'z'.repeat(9);
    const content = `${unbreakable(KNOWLEDGE_CHUNKING.maxChars - 5)} yy\n${tail}`;
    const chunks = chunk(text(content));

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.content).toHaveLength(KNOWLEDGE_CHUNKING.minChars);
    expect(chunks[1]?.content.endsWith(tail)).toBe(true);
  });
});

describe('boundaries that would corrupt a character', () => {
  it('never cuts between the halves of an emoji', () => {
    // The leading 'A' pushes the run off even code units, so a ceiling taken as a count of
    // code units lands inside a surrogate pair and has to be backed off.
    const chunks = chunk(text(`A${GRINNING.repeat(1_500)}`));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      // Spreading a string iterates code points, so a half-emoji would survive here as an
      // unpaired surrogate and fail the membership test.
      expect([...piece.content].every((character) => character === 'A' || character === GRINNING)).toBe(true);
    }
  });

  it('never leaves a combining mark at the start of a chunk', () => {
    const chunks = chunk(text(`a${COMBINING_ACUTE}`.repeat(800)));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      expect(piece.content).not.toMatch(/^\p{M}/u);
      expect(piece.content.length % 2).toBe(0);
    }
  });

  it('would rather exceed the ceiling than break one very long character', () => {
    // A base letter carrying fifteen hundred combining marks is a single grapheme cluster
    // with no cut anywhere inside it. Retrieval truncates an over-long chunk before showing
    // it; a character split in storage is wrong for ever. Not text a person types.
    const chunks = chunkKnowledgeSource(text(`a${COMBINING_ACUTE.repeat(1_500)}`));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content.length).toBeGreaterThan(KNOWLEDGE_CHUNKING.maxChars);
    expect(hasLoneSurrogate(chunks[0]?.content ?? '')).toBe(false);
  });

  it('keeps a joined family emoji whole', () => {
    const chunks = chunk(text(FAMILY.repeat(400)));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      expect(piece.content.startsWith(ZWJ)).toBe(false);
      expect(piece.content.endsWith(ZWJ)).toBe(false);
      expect(piece.content.length % FAMILY.length).toBe(0);
    }
  });

  it('keeps a flag whole, and still cuts a run of them', () => {
    // Every position in a run of flags has a regional indicator on both sides, so a rule
    // written from the neighbours alone finds no legal cut and returns the whole run as one
    // over-long chunk. Both assertions matter: whole flags, and a run that still gets cut.
    const chunks = chunk(text(FLAG_PAKISTAN.repeat(750)));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      expect(piece.content.length % FLAG_PAKISTAN.length).toBe(0);
      expect([...piece.content].length % 2).toBe(0);
    }
  });

  it('keeps a skin tone attached to the emoji it modifies', () => {
    const chunks = chunk(text(THUMBS_UP.repeat(750)));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      expect(piece.content.length % THUMBS_UP.length).toBe(0);
    }
  });

  it('never cuts across a zero-width non-joiner', () => {
    // The non-joiner selects a letter's joining form in Urdu. A cut across it changes the
    // word rather than merely moving a boundary, which is why it is preserved and why no
    // chunk may begin or end on one.
    const sentence = `ڈیلیوری کا وقت دو${ZWNJ}تین دن ہے${URDU_FULL_STOP} `;
    const chunks = chunk(text(sentence.repeat(60).trim()));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((piece) => piece.content.includes(ZWNJ))).toBe(true);
    for (const piece of chunks) {
      expect(piece.content.startsWith(ZWNJ)).toBe(false);
      expect(piece.content.endsWith(ZWNJ)).toBe(false);
    }
  });

  it('carries bidi marks through untouched', () => {
    // They decide the visual order of a mixed line, so losing one reorders what the owner
    // wrote. The chunker removes nothing; this is the assertion that keeps it that way.
    const line = `${RIGHT_TO_LEFT_MARK}قیمت Rs. 250 ہے${URDU_FULL_STOP} `;
    const short = chunk(text(line.trim()));
    const long = chunk(text(line.repeat(80).trim()));

    expect(short[0]?.content).toBe(line.trim());
    expect(long.every((piece) => piece.content.includes(RIGHT_TO_LEFT_MARK))).toBe(true);
  });
});

describe('the normalisation the chunker is handed', () => {
  it('cuts composed and decomposed text identically, because normalisation ran first', () => {
    // The chunker does not normalise — validation does, once, so that stored text, hashed
    // text and embedded text are one string. What that buys is this: the same Urdu or
    // accented word typed two ways cannot produce two different corpora.
    const decomposed = `Order a${COMBINING_ACUTE}gay confirm ho gaya hai${URDU_FULL_STOP} `.repeat(60).trim();
    const composed = decomposed.normalize('NFC');

    expect(decomposed).not.toBe(composed);
    expect(normalizeKnowledgeText(decomposed)).toBe(normalizeKnowledgeText(composed));
    expect(chunk(text(normalizeKnowledgeText(decomposed)))).toEqual(
      chunk(text(normalizeKnowledgeText(composed))),
    );
  });
});

describe('the languages a Pakistani shop actually writes in', () => {
  it('cuts a mixed Urdu, Roman Urdu and English document without losing any of it', () => {
    const source = normalizeKnowledgeText(
      [
        'Delivery charges Lahore aur Karachi ke liye Rs. 250 hain.',
        `ڈیلیوری دو سے تین دن میں ہو جاتی ہے${URDU_FULL_STOP}`,
        'COD available hai, advance payment par 5% discount milta hai.',
        'Exchange 7 din ke andar, receipt ke saath, bina pehne hue.',
        `کیا آپ کے پاس XL سائز ہے${String.fromCodePoint(0x061f)}`,
      ]
        .join(' ')
        .repeat(12),
    );
    const chunks = chunk(text(source));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      // Every chunk is a verbatim stretch of the source: nothing transliterated, nothing
      // lowercased, no punctuation dropped.
      expect(source).toContain(piece.content);
    }
  });

  it('treats an Urdu question mark as a sentence end', () => {
    const urduQuestionMark = String.fromCodePoint(0x061f);
    const chunks = chunk(text(`کیا ڈیلیوری فری ہے${urduQuestionMark} `.repeat(90).trim()));

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks.slice(0, -1)) {
      expect(piece.content.endsWith(urduQuestionMark)).toBe(true);
    }
  });
});

describe('a question and its answer', () => {
  const question = 'Return aur exchange ka process kya hai?';

  it('embeds a short pair as one labelled chunk', () => {
    const answer = 'Receipt ke saath 7 din ke andar exchange ho jata hai.';
    const chunks = chunk(faq(question, answer));

    expect(chunks).toHaveLength(1);
    // The labels are part of the embedded text: a customer's message is a question, and a
    // chunk shaped like one sits closer to it than the bare answer would.
    expect(chunks[0]?.content).toBe(`Q: ${question}\nA: ${answer}`);
  });

  it('repeats the question on every piece of a long answer', () => {
    const answer = sentences(50, 'Exchange');
    const chunks = chunk(faq(question, answer));
    const prefix = `Q: ${question}\nA: `;

    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      // Without the prefix the second half of a returns policy has no words in it that
      // resemble "can I exchange this?" — the question is where that resemblance lives.
      expect(piece.content.startsWith(prefix)).toBe(true);
      expect(piece.content.split(question)).toHaveLength(2);
      expect(answer).toContain(piece.content.slice(prefix.length));
    }
  });

  it('splits the answer against a ceiling reduced by the repeated question', () => {
    const chunks = chunk(faq(question, unbreakable(4_000)));
    const room = KNOWLEDGE_CHUNKING.maxChars - `Q: ${question}\nA: `.length;

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.content).toHaveLength(KNOWLEDGE_CHUNKING.maxChars);
    for (const piece of chunks) {
      expect(piece.content.length - `Q: ${question}\nA: `.length).toBeLessThanOrEqual(room);
    }
  });
});

describe('more pieces than one document may hold', () => {
  it('refuses permanently rather than embedding hundreds of pieces', () => {
    // Validation refuses this length long before ingestion, so the guard is only reachable
    // by calling the chunker directly — which is exactly what a future source type that
    // produces text from a file would do.
    const enormous = unbreakable(
      KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT * KNOWLEDGE_CHUNKING.maxChars,
    );

    expect(() => chunkKnowledgeSource(text(enormous))).toThrow(
      expect.objectContaining({ failureCode: 'CONTENT_TOO_LARGE' }),
    );
  });
});



