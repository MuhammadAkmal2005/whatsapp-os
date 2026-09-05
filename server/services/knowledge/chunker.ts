/**
 * Cutting a knowledge document into the pieces that get embedded.
 *
 * Pure: no database, no network, no clock, no randomness. The same input produces the
 * same output on every machine and in every process, which is what makes re-ingestion
 * safe — a document re-embedded after a provider outage must land on the same boundaries
 * as the attempt that failed, or its pieces would shuffle under a corpus that has already
 * been retrieved from.
 *
 * The unit is **characters** — JavaScript string length, i.e. UTF-16 code units — and
 * `config/constants.ts` explains why that is the right unit rather than tokens. What
 * matters here is the consequence: a boundary is chosen by counting code units, so the
 * splitting code has to take care never to land *between* two code units that belong to
 * one character. `safeBoundary` below is the whole of that care.
 *
 * `Intl.Segmenter` is deliberately not used. It is the obvious tool for grapheme
 * boundaries and it is the wrong one here: its output depends on the ICU version bundled
 * with the runtime, so Node 20 and Node 22 can disagree about where a piece ends. A
 * corpus whose boundaries move when the platform is upgraded is a corpus whose stored
 * text no longer matches what a re-ingestion would produce.
 *
 * Input is expected to be already normalised by `server/validation/knowledge.ts`. That is
 * not a defensive claim this module re-checks — normalisation is a validation-boundary
 * concern and doing it twice would mean two implementations to keep in step.
 */

import {
  APPROX_CHARS_PER_TOKEN,
  KNOWLEDGE_CHUNKING,
  KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT,
} from '@/config/constants';

import { KnowledgeIngestFailure } from './errors';

/**
 * What the chunker is given: the source fields only.
 *
 * The title is absent on purpose. It is how a person finds the document in a list, not
 * something the customer asked about, and prefixing every piece with it would spend the
 * evidence budget on a label while making every piece of one document look alike to a
 * vector search.
 */
export type ChunkSource =
  | { readonly type: 'TEXT'; readonly content: string }
  | { readonly type: 'FAQ'; readonly question: string; readonly answer: string };

export type KnowledgeChunkDraft = {
  /** Dense, zero-based, in reading order. */
  readonly position: number;
  readonly content: string;
  /** `ceil(characters / APPROX_CHARS_PER_TOKEN)` — see `estimateTokens`. */
  readonly tokenCount: number;
};

/**
 * The size rules one call to the splitter works to.
 *
 * Parameterised rather than read from configuration inside the splitter, because the FAQ
 * path needs a smaller ceiling than the TEXT path: every piece of a long answer carries
 * the question again, and that prefix has to come out of the same 1,200 characters.
 */
type Budget = {
  /** What a piece aims for. */
  readonly targetChars: number;
  /** What a piece may never exceed. */
  readonly maxChars: number;
  /** Carried from the end of one piece into the start of the next. */
  readonly overlapChars: number;
  /** Below this a piece is a fragment. */
  readonly minChars: number;
};

/** A half-open span of the source, `[start, end)`. */
type Span = { start: number; end: number };

/**
 * `ceil(characters / APPROX_CHARS_PER_TOKEN)`.
 *
 * The division is the whole point: four characters make roughly one token, so a
 * 900-character chunk is about 225 tokens. Multiplying instead — which is the easy slip,
 * since both numbers sit next to each other — would claim 3,600 and make every budget
 * that reads this number sixteen times too pessimistic.
 *
 * `ceil` so that a chunk shorter than one token still counts as one. Nothing costs zero.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

// ── Character-safe boundaries ────────────────────────────────────────────────

/**
 * Anything that belongs to the character before it: combining marks, variation
 * selectors and the enclosing keycap.
 *
 * `\p{M}` is the whole of that set — Unicode already classifies variation selectors and
 * U+20E3 as non-spacing marks — so this is one property test rather than a list of
 * ranges that would need revisiting every Unicode release.
 */
const JOINS_BACKWARD = /\p{M}/u;

const ZERO_WIDTH_NON_JOINER = 0x200c;
const ZERO_WIDTH_JOINER = 0x200d;
const REGIONAL_INDICATOR_FIRST = 0x1f1e6;
const REGIONAL_INDICATOR_LAST = 0x1f1ff;
const EMOJI_MODIFIER_FIRST = 0x1f3fb;
const EMOJI_MODIFIER_LAST = 0x1f3ff;

/** The code point ending at `index`, reading a surrogate pair as the one character it is. */
function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) return undefined;
  const trailing = text.charCodeAt(index - 1);
  if (trailing >= 0xdc00 && trailing <= 0xdfff && index >= 2) {
    const leading = text.charCodeAt(index - 2);
    if (leading >= 0xd800 && leading <= 0xdbff) {
      return (leading - 0xd800) * 0x400 + (trailing - 0xdc00) + 0x10000;
    }
  }
  return trailing;
}

/**
 * Whether cutting the string at `index` would leave a character in two halves.
 *
 * Every case below is one where two code units mean one thing to a reader, and where
 * separating them produces text that is either invalid or says something else:
 *
 * - **A surrogate pair** is one character stored as two code units. Split it and both
 *   halves are lone surrogates — not valid UTF-8, so Postgres stores replacement
 *   characters and the chunk no longer contains what the owner wrote.
 * - **A combining mark** belongs to the letter in front of it. "ā" as base plus macron
 *   becomes "a" and a floating macron.
 * - **The zero-width joiner** binds what is on both sides of it. Half of "👨‍👩‍👧" is two
 *   people and a dangling joiner.
 * - **The zero-width non-joiner** is not decoration in Urdu, Persian or Arabic — it
 *   selects a letter's joining form, so a cut across it changes the word. This is the
 *   same reason the normaliser preserves it.
 * - **The second of a pair of regional indicators** is half a flag — see `splitsFlag`.
 * - **An emoji modifier** is a skin tone applied to the emoji before it.
 */
function isSafeBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;

  const before = text.charCodeAt(index - 1);
  const at = text.charCodeAt(index);
  if (before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff) return false;

  const following = text.codePointAt(index);
  const preceding = codePointBefore(text, index);
  if (following === undefined || preceding === undefined) return true;

  if (JOINS_BACKWARD.test(String.fromCodePoint(following))) return false;
  if (following === ZERO_WIDTH_JOINER || preceding === ZERO_WIDTH_JOINER) return false;
  if (following === ZERO_WIDTH_NON_JOINER || preceding === ZERO_WIDTH_NON_JOINER) return false;
  if (isInRange(following, EMOJI_MODIFIER_FIRST, EMOJI_MODIFIER_LAST)) return false;

  return !splitsFlag(text, index, following);
}

/**
 * Whether cutting at `index` would take one letter of a flag.
 *
 * Two regional indicators make one flag and a run of them is read in pairs from its start,
 * so in "🇵🇰🇸🇦" the boundaries that exist are before the first flag, between the two, and
 * after the last. Looking only at the code points either side of `index` cannot tell those
 * apart from the position in the middle of a flag — every one of them has a regional
 * indicator on both sides. So the run behind `index` is counted instead, and an odd count
 * means `index` is the middle of a pair.
 *
 * Deciding this from the neighbours alone was the earlier version of this function and it
 * made every position in a run of flags unsafe, which sent `safeBoundary` past the ceiling
 * looking for a cut that by its own rule did not exist.
 */
function splitsFlag(text: string, index: number, following: number): boolean {
  if (!isInRange(following, REGIONAL_INDICATOR_FIRST, REGIONAL_INDICATOR_LAST)) return false;

  let scan = index;
  let indicators = 0;
  for (;;) {
    const preceding = codePointBefore(text, scan);
    if (
      preceding === undefined ||
      !isInRange(preceding, REGIONAL_INDICATOR_FIRST, REGIONAL_INDICATOR_LAST)
    ) {
      break;
    }
    indicators += 1;
    scan -= 2; // Every regional indicator is above the BMP, so it is always two code units.
  }

  return indicators % 2 === 1;
}

function isInRange(codePoint: number, first: number, last: number): boolean {
  return codePoint >= first && codePoint <= last;
}

/** The nearest safe boundary at or before `index`, never below `floor`. */
function safeBoundary(text: string, index: number, floor: number): number {
  let candidate = Math.min(index, text.length);
  while (candidate > floor && !isSafeBoundary(text, candidate)) candidate -= 1;
  if (isSafeBoundary(text, candidate)) return candidate;

  // Nothing in the whole window may be cut, which means the window is the inside of one
  // very long grapheme cluster. Growing past the ceiling is then the lesser evil:
  // retrieval truncates an over-long chunk before showing it, while a split character is
  // corrupt in storage for ever. Input like this is not something a person types.
  let forward = index;
  while (forward < text.length && !isSafeBoundary(text, forward)) forward += 1;
  return forward;
}

// ── The separator ladder ─────────────────────────────────────────────────────

const LINE_FEED = '\n';
const WHITESPACE = /\s/;

/**
 * What ends a sentence, built from code points rather than pasted in as literals.
 *
 * Two of these are right-to-left punctuation. Written literally they reorder the source
 * line around them in an editor, so a reviewer reading the array cannot tell which
 * characters it actually holds — the same reason the normaliser names U+200B by number.
 */
const SENTENCE_ENDERS = new Set([
  '.',
  '?',
  '!',
  String.fromCodePoint(0x06d4), // Urdu full stop
  String.fromCodePoint(0x061f), // Urdu and Arabic question mark
]);

/** Whether the next piece may begin at `index`, for one rung of the ladder. */
type CutTest = (text: string, index: number) => boolean;

/** A blank line: the piece ends with a whole paragraph. */
function isParagraphCut(text: string, index: number): boolean {
  return text[index] === LINE_FEED && text[index + 1] === LINE_FEED;
}

/** Any newline. A list of delivery charges, one city per line, breaks here. */
function isLineCut(text: string, index: number): boolean {
  return text[index] === LINE_FEED;
}

/**
 * Just past a sentence ender, and only when whitespace follows.
 *
 * The lookahead is what keeps "Rs. 3,499" and "size 8.5" whole. Without it every decimal
 * point in a price list is a candidate boundary and pieces end mid-number.
 */
function isSentenceCut(text: string, index: number): boolean {
  const ender = text[index - 1];
  const next = text[index];
  if (ender === undefined || next === undefined) return false;
  return SENTENCE_ENDERS.has(ender) && WHITESPACE.test(next);
}

/** A word start: whitespace behind it, a word ahead of it. */
function isWordCut(text: string, index: number): boolean {
  const previous = text[index - 1];
  const next = text[index];
  if (previous === undefined || next === undefined) return false;
  return WHITESPACE.test(previous) && !WHITESPACE.test(next);
}

/** Highest priority first. The first rung with a candidate in the window wins outright. */
const SEPARATOR_LADDER: readonly CutTest[] = [
  isParagraphCut,
  isLineCut,
  isSentenceCut,
  isWordCut,
];

// ── Packing ──────────────────────────────────────────────────────────────────

/**
 * Where the piece beginning at `start` should end, or `null` when the window between the
 * minimum and the ceiling holds no separator at all.
 *
 * Two rules combine. The **ladder** decides which kind of boundary is acceptable: a
 * paragraph break anywhere in the window beats a sentence end, because a paragraph is a
 * complete thought and half of one is evidence that answers a question wrongly. Within a
 * rung, the candidate **closest to the target** wins, which is what keeps ordinary prose
 * landing near 900 characters while still allowing 1,200 to reach a good break.
 */
function findCut(text: string, budget: Budget, start: number): number | null {
  const lowest = start + budget.minChars;
  const highest = Math.min(start + budget.maxChars, text.length);
  const target = start + budget.targetChars;

  for (const test of SEPARATOR_LADDER) {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = lowest; index <= highest; index += 1) {
      if (!test(text, index) || !isSafeBoundary(text, index)) continue;
      const distance = Math.abs(index - target);
      // `<=` so that of two candidates equally far from the target the later one wins and
      // the piece is as full as this rung allows.
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }

    if (best !== null) return best;
  }

  return null;
}

/**
 * Where the piece after this one begins: `overlapChars` back from its end, moved forward
 * to a word start so the carried context does not open mid-word.
 *
 * The floor is what makes the walk terminate. Every piece is at least `minChars` long, so
 * advancing by at least that much bounds the number of pieces by the length of the
 * document; without it a run of short pieces could overlap almost entirely and the walk
 * would crawl forward a character at a time over fifty thousand of them.
 */
function nextStart(text: string, budget: Budget, start: number, end: number): number {
  const floor = start + Math.min(budget.minChars, end - start);
  const desired = Math.max(end - budget.overlapChars, floor);
  if (desired >= end) return end;

  for (let index = desired; index < end; index += 1) {
    if (isWordCut(text, index) && isSafeBoundary(text, index)) return index;
  }

  return Math.min(safeBoundary(text, desired, floor), end);
}

/**
 * Where the last piece begins.
 *
 * Normally where the overlap left off. When the remainder is shorter than `minChars` it
 * reaches further back instead: a lone fragment — "and delivery is free." — scores well
 * enough against a question about delivery to be chosen as evidence and then tells the
 * model nothing it can quote, so it is folded into the text behind it. That duplicates a
 * little more of the previous piece, which is exactly what the overlap already does on
 * purpose.
 *
 * Only the final piece can be short. Every other one is cut at or past `minChars` by
 * construction, and the pull-back is bounded at twice that, so the piece this returns is
 * between one and two `minChars` long and never near the ceiling.
 */
function finalStart(text: string, budget: Budget, start: number): number {
  if (text.length - start >= budget.minChars) return start;

  const wanted = text.length - budget.minChars;
  const floor = Math.max(0, text.length - budget.minChars * 2);
  for (let index = wanted; index > floor; index -= 1) {
    if (isWordCut(text, index) && isSafeBoundary(text, index)) return index;
  }

  return safeBoundary(text, wanted, floor);
}

/**
 * Walks the source once, choosing each piece's end and where the next one starts.
 *
 * A source that already fits becomes exactly one piece, untouched. That is not an
 * optimisation — it is the common case, since a delivery policy or a single answer is
 * usually a few hundred characters, and cutting it would scatter one coherent statement
 * across pieces that each half-answer the question.
 */
function cutSpans(text: string, budget: Budget): Span[] {
  if (text.length === 0) return [];
  if (text.length <= budget.maxChars) return [{ start: 0, end: text.length }];

  const spans: Span[] = [];
  let start = 0;

  while (start < text.length) {
    if (text.length - start <= budget.maxChars) {
      spans.push({ start: finalStart(text, budget, start), end: text.length });
      break;
    }

    // No separator in the window means text with no paragraph, line, sentence or word
    // break for over a thousand characters — a pasted identifier or an unspaced language.
    // It still has to be cut, so it is cut at the ceiling, backed off the inside of a
    // character.
    const end =
      findCut(text, budget, start) ?? safeBoundary(text, start + budget.maxChars, start + 1);

    spans.push({ start, end });
    start = nextStart(text, budget, start, end);
  }

  return spans;
}

/** Trimmed text for each span. Whitespace-only spans are dropped rather than embedded. */
function sliceSpans(text: string, spans: readonly Span[]): string[] {
  const pieces: string[] = [];
  for (const span of spans) {
    const piece = text.slice(span.start, span.end).trim();
    if (piece.length > 0) pieces.push(piece);
  }
  return pieces;
}

// ── The two sources ──────────────────────────────────────────────────────────

const TEXT_BUDGET: Budget = {
  targetChars: KNOWLEDGE_CHUNKING.targetChars,
  maxChars: KNOWLEDGE_CHUNKING.maxChars,
  overlapChars: KNOWLEDGE_CHUNKING.overlapChars,
  minChars: KNOWLEDGE_CHUNKING.minChars,
};

/**
 * The shape a question and answer are embedded in.
 *
 * The labels are part of the embedded text on purpose. A customer's message is a question,
 * and a piece that reads as a question and its answer sits closer to it in the vector space
 * than the answer alone would. They also survive into the evidence block, where they tell
 * the model which half was asked and which was answered.
 */
function faqUnit(question: string, answer: string): string {
  return `Q: ${question}\nA: ${answer}`;
}

function textPieces(content: string): string[] {
  return sliceSpans(content, cutSpans(content, TEXT_BUDGET));
}

/**
 * A Q&A, whole if it fits and otherwise the answer split under a repeated question.
 *
 * Repeating the question on every piece is what makes each piece independently
 * retrievable: the second half of a long returns policy, on its own, has no words in it
 * that resemble "can I exchange this?" — the question is where that resemblance lives.
 * It costs the question's length on every piece, which is why the answer is split against
 * a ceiling reduced by exactly that much rather than against the full 1,200.
 */
function faqPieces(question: string, answer: string): string[] {
  const whole = faqUnit(question, answer);
  if (whole.length <= KNOWLEDGE_CHUNKING.maxChars) return [whole];

  const room = KNOWLEDGE_CHUNKING.maxChars - faqUnit(question, '').length;

  // Unreachable while a question is capped far below the chunk ceiling, and cheap
  // insurance against that cap being raised: a budget with no room left would otherwise
  // ask the walk to advance zero characters at a time.
  if (room < KNOWLEDGE_CHUNKING.minChars) throw new KnowledgeIngestFailure('CONTENT_TOO_LARGE');

  const budget: Budget = {
    maxChars: room,
    // The answer is packed as full as it fits rather than aiming below the ceiling: pieces
    // here are already paying for the question twice over, so fewer of them is better.
    targetChars: room,
    overlapChars: Math.min(KNOWLEDGE_CHUNKING.overlapChars, Math.floor(room / 2)),
    minChars: Math.min(KNOWLEDGE_CHUNKING.minChars, room),
  };

  return sliceSpans(answer, cutSpans(answer, budget)).map((part) => faqUnit(question, part));
}

/**
 * The one entry point: a source in, the pieces to embed out.
 *
 * Both refusals are permanent by design. A retry runs this same deterministic code over
 * the same stored text and reaches the same conclusion, so re-queueing would burn attempts
 * and leave the row reading "Processing" for another ten minutes before saying the same
 * thing. `classifyIngestFailure` is what turns them into that decision.
 *
 * Zero pieces from a source that passed validation would mean the two disagree about what
 * empty is, which is a bug rather than bad input — but it must not reach the database,
 * where a document with no pieces is a READY document that can never be retrieved.
 */
export function chunkKnowledgeSource(source: ChunkSource): KnowledgeChunkDraft[] {
  const pieces =
    source.type === 'FAQ' ? faqPieces(source.question, source.answer) : textPieces(source.content);

  if (pieces.length === 0) throw new KnowledgeIngestFailure('CONTENT_EMPTY');
  if (pieces.length > KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT) {
    throw new KnowledgeIngestFailure('CONTENT_TOO_LARGE');
  }

  return pieces.map((content, position) => ({
    position,
    content,
    tokenCount: estimateTokens(content),
  }));
}
