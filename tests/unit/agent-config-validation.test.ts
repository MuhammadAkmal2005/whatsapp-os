/**
 * The agent configuration schema.
 *
 * This schema is the only thing between an HTML form post and an UPDATE on the workspace's
 * `ai_agents` row, so the cases here are the ones a form specifically produces: empty strings
 * where a number belongs, the literal string `'false'` where a boolean belongs, and keys that
 * were never on the screen.
 */

import { describe, expect, it } from 'vitest';

import { AGENT_CONFIG_LIMITS } from '@/config/constants';
import {
  formatHandoffKeywordList,
  normaliseHandoffKeywords,
  parseHandoffKeywordList,
  updateAgentConfigSchema,
} from '@/server/validation/agent';

/**
 * A complete, valid post — every value a string, because that is all a form can send.
 * Each test overrides only the field it is about.
 */
function formPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Sana',
    role: 'SALES_SUPPORT',
    tone: 'FRIENDLY',
    persona: 'Warm and brief, never pushy.',
    greeting: 'Assalam o Alaikum! Main aap ki kya madad kar sakti hoon?',
    customInstructions: 'Karachi delivery is next day. COD is available.',
    handoffKeywords: 'manager\ncomplaint',
    temperature: '0.3',
    maxOutputTokens: '600',
    isActive: 'true',
    ...overrides,
  };
}

/**
 * The messages a rejected post produced for one field. Asserted per field rather than on the
 * first issue, because a post can break two rules at once and "the first message" then
 * depends on the order the schema happens to check in.
 */
function fieldIssues(input: Record<string, unknown>, field: string): string[] {
  const parsed = updateAgentConfigSchema.safeParse(input);
  if (parsed.success) throw new Error(`expected ${field} to be rejected`);
  return parsed.error.issues.filter((issue) => issue.path[0] === field).map((issue) => issue.message);
}

describe('updateAgentConfigSchema', () => {
  it('accepts a complete post and hands the service real types', () => {
    const parsed = updateAgentConfigSchema.safeParse(formPost());

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.name).toBe('Sana');
    expect(parsed.data.role).toBe('SALES_SUPPORT');
    expect(parsed.data.tone).toBe('FRIENDLY');
    expect(parsed.data.temperature).toBe(0.3);
    expect(parsed.data.maxOutputTokens).toBe(600);
    expect(parsed.data.isActive).toBe(true);
    expect(parsed.data.handoffKeywords).toEqual(['manager', 'complaint']);
  });

  it('keeps only the fields on the screen, whatever else was posted', () => {
    // Everything after `isActive` here is a column the form never renders: the tenant the row
    // belongs to, the model the deployment stamped on it, its usage counters, and the flags
    // that are stored but which nothing in the runtime reads yet. Zod strips unknown keys, so
    // they are gone before the service is called — the allow-list is the absence of a schema
    // member, not a filtering step someone has to remember to run.
    const parsed = updateAgentConfigSchema.safeParse(
      formPost({
        workspaceId: '00000000-0000-0000-0000-000000000000',
        id: 'an-agent-in-another-workspace',
        model: 'gpt-4o',
        isDefault: 'false',
        confidenceFloor: '0.99',
        businessHoursOnly: 'true',
        languages: ['en'],
        escalationRules: { escalate: 'always' },
        conversationsHandled: '9999',
        handoffCount: '9999',
        ordersCreated: '9999',
        createdAt: '2020-01-01',
        updatedAt: '2020-01-01',
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(Object.keys(parsed.data).sort()).toEqual([
      'customInstructions',
      'greeting',
      'handoffKeywords',
      'isActive',
      'maxOutputTokens',
      'name',
      'persona',
      'role',
      'temperature',
      'tone',
    ]);
  });

  it('rejects a wording variety outside the range the runtime supports', () => {
    expect(
      fieldIssues(
        formPost({ temperature: String(AGENT_CONFIG_LIMITS.temperatureMax + 0.5) }),
        'temperature',
      ),
    ).not.toHaveLength(0);
    expect(
      fieldIssues(
        formPost({ temperature: String(AGENT_CONFIG_LIMITS.temperatureMin - 0.1) }),
        'temperature',
      ),
    ).not.toHaveLength(0);
  });

  it('rejects a wording variety that is not a finite number', () => {
    // `z.coerce.number()` turns 'abc' into NaN and 'Infinity' into Infinity. Either would
    // reach the provider as a sampling parameter it cannot act on.
    expect(fieldIssues(formPost({ temperature: 'abc' }), 'temperature')).not.toHaveLength(0);
    expect(fieldIssues(formPost({ temperature: 'NaN' }), 'temperature')).not.toHaveLength(0);
    expect(fieldIssues(formPost({ temperature: 'Infinity' }), 'temperature')).not.toHaveLength(0);
    expect(fieldIssues(formPost({ temperature: '-Infinity' }), 'temperature')).not.toHaveLength(0);
  });

  it('treats a cleared number box as missing rather than as zero', () => {
    // `formData.get` returns '' for an emptied input and `z.coerce.number()` reads '' as 0.
    // Left alone, clearing the reply-length box would save "zero tokens" — a save that
    // reports success and produces an assistant which says nothing.
    expect(fieldIssues(formPost({ temperature: '' }), 'temperature')).not.toHaveLength(0);
    expect(fieldIssues(formPost({ maxOutputTokens: '' }), 'maxOutputTokens')).not.toHaveLength(0);
  });

  it('bounds the reply length and requires a whole number of tokens', () => {
    const rejected = (value: string) =>
      fieldIssues(formPost({ maxOutputTokens: value }), 'maxOutputTokens');

    expect(rejected('0')).not.toHaveLength(0);
    expect(rejected(String(AGENT_CONFIG_LIMITS.maxOutputTokensMin - 1))).not.toHaveLength(0);
    expect(rejected(String(AGENT_CONFIG_LIMITS.maxOutputTokensMax + 1))).not.toHaveLength(0);
    expect(rejected('600.5')).not.toHaveLength(0);
    // Large enough to be a bill rather than a WhatsApp message.
    expect(rejected('1000000')).not.toHaveLength(0);
  });

  it('normalises handover words: trimmed, lower-cased, de-duplicated, first-seen order kept', () => {
    // Lower-casing is not cosmetic. The runtime lower-cases the inbound message and compares
    // with `includes`, so a stored 'Manager' would never match anything and the owner would
    // have no way to see why.
    const parsed = updateAgentConfigSchema.safeParse(
      formPost({ handoffKeywords: '  Manager \n manager\nCOMPLAINT\n\nrefund , shikayat \n' }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.handoffKeywords).toEqual(['manager', 'complaint', 'refund', 'shikayat']);
  });

  it('collapses words that differ only in case, so each one is tested once per message', () => {
    expect(normaliseHandoffKeywords(['Manager', 'MANAGER', 'manager'])).toEqual(['manager']);
  });

  it('accepts an empty handover list', () => {
    const parsed = updateAgentConfigSchema.safeParse(formPost({ handoffKeywords: '' }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.handoffKeywords).toEqual([]);
  });

  it('counts handover words after normalisation, not before', () => {
    // Twice the cap, but every entry is the same word. One is stored, so the post stands
    // rather than being rejected for a size it does not have once saved.
    const duplicated = Array.from(
      { length: AGENT_CONFIG_LIMITS.handoffKeywordsMax * 2 },
      () => 'manager',
    ).join('\n');

    const parsed = updateAgentConfigSchema.safeParse(formPost({ handoffKeywords: duplicated }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.handoffKeywords).toEqual(['manager']);
  });

  it('caps the number of handover words and the length of each', () => {
    const tooMany = Array.from(
      { length: AGENT_CONFIG_LIMITS.handoffKeywordsMax + 1 },
      (_unused, index) => `word${index}`,
    ).join('\n');
    expect(fieldIssues(formPost({ handoffKeywords: tooMany }), 'handoffKeywords')).not.toHaveLength(
      0,
    );

    const tooLong = 'x'.repeat(AGENT_CONFIG_LIMITS.handoffKeywordMax + 1);
    expect(fieldIssues(formPost({ handoffKeywords: tooLong }), 'handoffKeywords')).not.toHaveLength(
      0,
    );
  });

  it('requires a name, and does not accept whitespace as one', () => {
    expect(fieldIssues(formPost({ name: '' }), 'name')).not.toHaveLength(0);
    expect(fieldIssues(formPost({ name: '   ' }), 'name')).not.toHaveLength(0);
  });

  it('rejects oversized text in every free-text field', () => {
    const over = (max: number) => 'x'.repeat(max + 1);

    expect(
      fieldIssues(formPost({ name: over(AGENT_CONFIG_LIMITS.nameMax) }), 'name'),
    ).not.toHaveLength(0);
    expect(
      fieldIssues(formPost({ persona: over(AGENT_CONFIG_LIMITS.personaMax) }), 'persona'),
    ).not.toHaveLength(0);
    expect(
      fieldIssues(formPost({ greeting: over(AGENT_CONFIG_LIMITS.greetingMax) }), 'greeting'),
    ).not.toHaveLength(0);
    expect(
      fieldIssues(
        formPost({ customInstructions: over(AGENT_CONFIG_LIMITS.customInstructionsMax) }),
        'customInstructions',
      ),
    ).not.toHaveLength(0);
  });

  it('stores a cleared text field as null rather than as an empty string', () => {
    // The columns mean "no persona at all"; '' would put a blank labelled line into the
    // system prompt on every reply.
    const parsed = updateAgentConfigSchema.safeParse(
      formPost({ persona: '   ', greeting: '', customInstructions: '\n' }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.persona).toBeNull();
    expect(parsed.data.greeting).toBeNull();
    expect(parsed.data.customInstructions).toBeNull();
  });

  it('trims the text it keeps', () => {
    const parsed = updateAgentConfigSchema.safeParse(
      formPost({ name: '  Sana  ', persona: '  Warm and brief.  ' }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.name).toBe('Sana');
    expect(parsed.data.persona).toBe('Warm and brief.');
  });

  it('rejects a job or a style outside the listed set', () => {
    expect(fieldIssues(formPost({ role: 'ADMINISTRATOR' }), 'role')).not.toHaveLength(0);
    expect(fieldIssues(formPost({ tone: 'SARCASTIC' }), 'tone')).not.toHaveLength(0);
  });

  it("reads the string 'false' as switched off, not as a truthy string", () => {
    // `z.coerce.boolean()` would make this `true`, because every non-empty string is truthy —
    // turning "switch my assistant off" into "leave it on".
    const off = updateAgentConfigSchema.safeParse(formPost({ isActive: 'false' }));
    expect(off.success).toBe(true);
    if (!off.success) return;
    expect(off.data.isActive).toBe(false);

    const on = updateAgentConfigSchema.safeParse(formPost({ isActive: 'true' }));
    expect(on.success).toBe(true);
    if (!on.success) return;
    expect(on.data.isActive).toBe(true);
  });

  it('treats a missing switch as off, which is the safe direction to fail in', () => {
    const post = formPost();
    delete post.isActive;

    const parsed = updateAgentConfigSchema.safeParse(post);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // A post that lost the field cannot leave an assistant quietly answering customers. The
    // form sends a hidden input alongside the switch so this case does not arise in practice.
    expect(parsed.data.isActive).toBe(false);
  });
});

describe('parseHandoffKeywordList', () => {
  it('splits on newlines and commas, and drops blank entries', () => {
    // Both separators, because both are what people type into a box that says one per line.
    // A trailing newline is not a mistake the owner should have to go back and fix.
    expect(parseHandoffKeywordList('manager\n\ncomplaint, refund ,\n')).toEqual([
      'manager',
      'complaint',
      'refund',
    ]);
  });

  it('round-trips a saved list back into the textarea and out again unchanged', () => {
    const saved = ['manager', 'complaint', 'refund'];

    expect(
      normaliseHandoffKeywords(parseHandoffKeywordList(formatHandoffKeywordList(saved))),
    ).toEqual(saved);
  });
});
