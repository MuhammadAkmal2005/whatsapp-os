/**
 * The words the knowledge screens are allowed to say.
 *
 * A shop owner is teaching their assistant about their business. They are not configuring a
 * retrieval system, and every piece of our vocabulary that leaks into the screen — "embedding",
 * "chunk", "similarity" — turns a task they understand into one they do not. That is a product
 * requirement, so it is checked like one rather than left to review.
 *
 * The patterns below use word boundaries, which means a camelCase identifier such as
 * `chunkCount` does not trip them while the prose word "chunk" does. That is deliberate: the
 * rule is about language a person reads, and a component is allowed to name the field the
 * database named. What a person actually reads is asserted separately and more strictly, on the
 * label and message values themselves rather than on the source text around them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { KNOWLEDGE_FAILURE_MESSAGES } from '@/server/services/knowledge/errors';
import { KNOWLEDGE_STATUS_LABELS } from '@/server/validation/knowledge';

/** Both halves of the surface: the route and the components it renders. */
const SURFACES = ['components/knowledge', join('app', '(app)', '(workspace)', 'knowledge')];

/**
 * Our vocabulary, as it would appear if it escaped.
 *
 * Each entry is the word a reader would see, not the identifier we write. Model names are
 * included because "gemini-embedding-001" in an error message is the same failure as
 * "embedding" in a heading, and the failure text is the likeliest place for it to arrive.
 */
const INTERNAL_VOCABULARY: ReadonlyArray<readonly [string, RegExp]> = [
  ['embedding', /\bembeddings?\b/i],
  ['vector', /\bvectors?\b/i],
  ['pgvector', /\bpgvector\b/i],
  ['HNSW', /\bhnsw\b/i],
  ['chunk', /\bchunks?\b/i],
  ['similarity', /\bsimilarity\b/i],
  ['cosine', /\bcosine\b/i],
  ['retrieval', /\bretrieval\b/i],
  ['top-k', /\btop[-\s]?k\b/i],
  ['dimension', /\bdimensions?\b|\bdimensionality\b|\bdims\b/i],
  ['batch size', /\bbatch\s+size\b/i],
  ['token budget', /\btoken\s+budget\b/i],
  ['a model name', /\bgemini[-\s]?\w*|\btext-embedding-\d/i],
];

function sourceFiles(directory: string): ReadonlyArray<{ path: string; source: string }> {
  const found: Array<{ path: string; source: string }> = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      found.push({ path, source: readFileSync(path, 'utf8') });
    }
  }

  return found;
}

describe('the knowledge screens speak the product’s language', () => {
  const files = SURFACES.flatMap((directory) => sourceFiles(directory));

  // A mistyped directory would make every assertion below pass while checking nothing, which
  // is the one way a test like this fails silently.
  it('found the screens it is checking', () => {
    expect(files.length).toBeGreaterThan(6);
    expect(files.map((file) => file.path)).toContain(
      join('components', 'knowledge', 'knowledge-table.tsx'),
    );
    expect(files.map((file) => file.path)).toContain(
      join('app', '(app)', '(workspace)', 'knowledge', 'page.tsx'),
    );
  });

  it.each(INTERNAL_VOCABULARY)('never says %s', (_word, pattern) => {
    const offenders = files.filter((file) => pattern.test(file.source)).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  // The statuses are the whole of what the list says about processing, so the four labels are
  // the vocabulary rather than an example of it.
  it('describes processing in four plain states', () => {
    expect(KNOWLEDGE_STATUS_LABELS).toEqual({
      PENDING: 'Processing…',
      PROCESSING: 'Processing…',
      READY: 'Ready',
      FAILED: 'Couldn’t process',
    });
  });

  /**
   * The failure messages, checked harder than the source text.
   *
   * These are the strings a person reads on their worst day with the feature, and they are
   * built from a provider failure — the one place where a status code, a stack frame or a model
   * name could realistically arrive in front of a customer.
   */
  it('explains a failure without naming anything internal', () => {
    for (const [code, message] of Object.entries(KNOWLEDGE_FAILURE_MESSAGES)) {
      for (const [word, pattern] of INTERNAL_VOCABULARY) {
        expect(pattern.test(message), `${code} mentions ${word}`).toBe(false);
      }

      // No status codes, no stack frames, no exception class names.
      expect(message, code).not.toMatch(/\b[45]\d{2}\b/);
      expect(message, code).not.toMatch(/\bat\s+\w+\s*\(|\.ts:\d+|\bError\b/);
      // Ordinary sentences, addressed to the reader.
      expect(message, code).toMatch(/^[A-Z][^\n]+[.?!]$/);
      expect(message.length, code).toBeLessThan(160);
    }
  });
});
