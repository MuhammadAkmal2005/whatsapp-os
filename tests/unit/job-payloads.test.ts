/**
 * Job payload schema tests.
 *
 * Runs under Vitest only: it exercises the real Zod schemas, and stubbing Zod so
 * this could run without an install would mean grading the stub instead of the
 * validator. See tools/sandbox-test.mjs.
 *
 * A payload is the only place a background job learns which workspace it acts on,
 * so a schema that lets a malformed one through is a scoping bug waiting for a
 * handler to dereference it.
 */

import { describe, expect, it } from 'vitest';

import { isJobType, JOB_DEFAULTS, JOB_TYPES, parseJobPayload } from '@/server/jobs/job-types';

describe('job payload schemas', () => {
  it('rejects a payload missing its workspace scope', () => {
    const result = parseJobPayload('ai.respond', {
      conversationId: '3f4b6c1e-0a2d-4f5b-8c7e-9d1a2b3c4d5e',
      messageId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-uuid id rather than passing it to a query', () => {
    const result = parseJobPayload('whatsapp.send_message', {
      workspaceId: 'not-a-uuid',
      messageId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed payload', () => {
    const result = parseJobPayload('whatsapp.send_message', {
      workspaceId: '3f4b6c1e-0a2d-4f5b-8c7e-9d1a2b3c4d5e',
      messageId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    });
    expect(result.ok).toBe(true);
  });

  it('reports the offending field so a dead job explains itself', () => {
    const result = parseJobPayload('knowledge.embed_chunks', {
      workspaceId: '3f4b6c1e-0a2d-4f5b-8c7e-9d1a2b3c4d5e',
      documentId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      chunkIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('chunkIds');
  });

  it('recognises only catalogued types', () => {
    expect(isJobType('maintenance.sweep')).toBe(true);
    expect(isJobType('drop.everything')).toBe(false);
  });

  it('gives the customer-facing job types priority over the reporting ones', () => {
    // Ordering matters more than the specific numbers: an analytics rollup must
    // never be claimed ahead of a customer waiting on a WhatsApp reply.
    const send = JOB_DEFAULTS['whatsapp.send_message']?.priority ?? 0;
    const rollup = JOB_DEFAULTS['analytics.rollup_daily']?.priority ?? 0;
    expect(send).toBeGreaterThan(rollup);
  });

  it('declares every catalogued type with a schema', () => {
    for (const type of JOB_TYPES) {
      expect(parseJobPayload(type, {}).ok !== undefined).toBe(true);
    }
    expect(JOB_TYPES.length).toBeGreaterThan(0);
  });
});
