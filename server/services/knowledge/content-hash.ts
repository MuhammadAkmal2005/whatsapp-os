/**
 * The fingerprint that stops the same policy being stored twice.
 *
 * Pure and deterministic: the same normalised source produces the same digest on every
 * machine, which is what lets a unique index rather than a service-layer read decide
 * whether a document already exists. A "does this exist?" query loses to a double-submitted
 * form — both requests read nothing, both insert — and the workspace ends up holding one
 * return policy twice, consuming two plan slots and returning as two pieces of evidence.
 *
 * The digest covers the title as well as the body, so two documents that differ only in
 * what they are called are two documents. That is deliberate: the title is how an owner
 * finds a row, and refusing "Delivery (old)" because it repeats the text of "Delivery"
 * would block a legitimate edit-in-progress.
 *
 * Input is expected already normalised by `server/validation/knowledge.ts`. Hashing
 * un-normalised text would defeat the whole exercise — the same document pasted twice out
 * of two editors differs by a byte order mark and would hash apart.
 */

import { sha256 } from '@/lib/crypto';

/**
 * The source fields a digest is taken over, shaped so a validated create or update payload
 * can be passed straight in.
 */
export type KnowledgeHashSource =
  | { readonly type: 'TEXT'; readonly title: string; readonly content: string }
  | {
      readonly type: 'FAQ';
      readonly title: string;
      readonly question: string;
      readonly answer: string;
    };

/**
 * Each field length-prefixed rather than delimited.
 *
 * A separator character — even an obscure one — can appear inside a field, and then a title
 * of "Delivery|Rs. 250" with an empty body hashes the same as a title of "Delivery" with a
 * body of "Rs. 250". Two documents an owner can tell apart must never collide, so the
 * encoding is one only a length prefix makes unambiguous.
 *
 * The version marker is part of the digest so that a future change to this encoding is a
 * visible break rather than a silent one: every existing hash stops matching, which is
 * correct, because they were taken over a different definition of "the same document".
 */
function canonical(fields: readonly string[]): string {
  return ['knowledge.v1', ...fields.map((field) => `${field.length}:${field}`)].join('|');
}

/** SHA-256, hex, over the canonical form of the source. */
export function knowledgeContentHash(source: KnowledgeHashSource): string {
  const fields =
    source.type === 'FAQ'
      ? [source.type, source.title, source.question, source.answer]
      : [source.type, source.title, source.content];

  return sha256(canonical(fields));
}
