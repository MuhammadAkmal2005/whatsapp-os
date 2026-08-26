import { describe, expect, it } from 'vitest';

import { COUNTRY_RULES, isValidE164, maskPhone, normalisePhone } from '@/lib/phone';

/**
 * `Contact.phoneE164` is the contact's identity key — `@@unique([workspaceId,
 * phoneE164])` — so this module decides whether one human is one contact or
 * three. It also produces the `waId` handed to Meta's API. Both consequences are
 * silent when wrong: a duplicated contact looks like a new customer, and an
 * unreachable number looks like a customer who never replies.
 *
 * All fictional numbers.
 */

/** The same Pakistani mobile, written the ways customers actually write it. */
const SAME_PK_NUMBER = [
  '0300 1234567',
  '03001234567',
  '+92 300 1234567',
  '+923001234567',
  '92-300-1234567',
  '923001234567',
  '3001234567',
  '0092 300 1234567',
  '+92 0300 1234567', // trunk prefix kept alongside the country code
  '  0300-1234-567  ',
  '(0300) 1234567',
];

describe('normalisePhone', () => {
  describe('one human is one contact', () => {
    it('collapses every way of writing the same Pakistani number to one E.164 value', () => {
      const results = SAME_PK_NUMBER.map((input) => normalisePhone(input));

      for (const [index, result] of results.entries()) {
        expect(result, `input ${JSON.stringify(SAME_PK_NUMBER[index])} did not normalise`).not.toBeNull();
      }

      const distinct = new Set(results.map((result) => result?.e164));
      expect(distinct).toEqual(new Set(['+923001234567']));
    });

    it('is idempotent, so re-normalising a stored value cannot change identity', () => {
      for (const input of SAME_PK_NUMBER) {
        const once = normalisePhone(input);
        expect(once).not.toBeNull();
        const twice = normalisePhone(once!.e164);
        expect(twice?.e164).toBe(once!.e164);
      }
    });
  });

  describe('the output is always a valid E.164 number', () => {
    // The invariant the rest of the system relies on: anything non-null here is
    // safe to store as an identity key and safe to hand to Meta.
    it('never returns a value isValidE164 would reject', () => {
      const inputs = [
        ...SAME_PK_NUMBER,
        '+44 7911 123456',
        '+1 415 555 0123',
        '+971 50 1234567',
        '+9999999999999',
        '+92 300 12345',
        '+0300123456',
        '+000000000',
        '000000000000',
      ];

      for (const input of inputs) {
        const result = normalisePhone(input);
        if (result !== null) {
          expect(isValidE164(result.e164), `${input} → ${result.e164}`).toBe(true);
        }
      }
    });

    // Regression. No country calling code begins with zero, so these describe no
    // real number. Both used to be returned as `+0300123456`, which would have
    // become a contact that could never receive a message and could never be
    // merged with the real one.
    it('rejects a leading-zero country code rather than inventing a number', () => {
      expect(normalisePhone('+0300123456')).toBeNull();
      expect(normalisePhone('+000000000')).toBeNull();
    });

    it('rejects a national number when the default country has no rule', () => {
      // Unknown country: the trunk prefix cannot be stripped, so the zero would
      // otherwise survive into the output.
      expect(normalisePhone('0300 1234567', 'ZZ')).toBeNull();
    });
  });

  describe('the default country decides an ambiguous national number', () => {
    it('applies the workspace country to a number with no international prefix', () => {
      expect(normalisePhone('07911123456', 'GB')?.e164).toBe('+447911123456');
      expect(normalisePhone('0501234567', 'AE')?.e164).toBe('+971501234567');
      expect(normalisePhone('4155550123', 'US')?.e164).toBe('+14155550123');
    });

    // Worth stating outright: the same digits are different people in different
    // workspaces, which is why `defaultCountry` must come from the workspace and
    // never from a hard-coded constant at the call site.
    it('resolves the same national digits differently per country', () => {
      expect(normalisePhone('07911123456', 'PK')?.e164).toBe('+927911123456');
      expect(normalisePhone('07911123456', 'GB')?.e164).toBe('+447911123456');
    });

    it('ignores the default country when the input carries its own prefix', () => {
      expect(normalisePhone('+44 7911 123456', 'PK')?.e164).toBe('+447911123456');
      expect(normalisePhone('0092 300 1234567', 'GB')?.e164).toBe('+923001234567');
    });

    it('defaults to Pakistan, the initial market', () => {
      expect(normalisePhone('0300 1234567')?.e164).toBe(normalisePhone('0300 1234567', 'PK')?.e164);
    });
  });

  describe('country attribution', () => {
    it('names the country when the calling code and length both match', () => {
      expect(normalisePhone('+923001234567')?.countryIso2).toBe('PK');
      expect(normalisePhone('+447911123456')?.countryIso2).toBe('GB');
      expect(normalisePhone('+971501234567')?.countryIso2).toBe('AE');
    });

    it('prefers the longest calling code, so +971 is never read as +9', () => {
      expect(normalisePhone('+971501234567')?.countryIso2).toBe('AE');
    });

    it('declines to claim a country when the length is wrong for it', () => {
      // Right calling code, too few digits. Kept as E.164 rather than discarded,
      // but attributing a country would be a guess.
      const result = normalisePhone('+92 300 12345');
      expect(result?.e164).toBe('+9230012345');
      expect(result?.countryIso2).toBeNull();
    });

    it('accepts a country we have no rule for without pretending to know it', () => {
      const result = normalisePhone('+9999999999999');
      expect(result?.e164).toBe('+9999999999999');
      expect(result?.countryIso2).toBeNull();
    });

    it('has a rule for every country whose calling code it claims', () => {
      for (const rule of COUNTRY_RULES) {
        expect(rule.callingCode).toMatch(/^[1-9]\d*$/);
        expect(rule.nationalNumberLengths.length).toBeGreaterThan(0);
      }
    });
  });

  describe('waId is the form Meta wants', () => {
    it('is the E.164 value without the plus', () => {
      const result = normalisePhone('0300 1234567');
      expect(result?.waId).toBe('923001234567');
      expect(result?.waId).toBe(result?.e164.slice(1));
    });

    it('contains digits only', () => {
      for (const input of SAME_PK_NUMBER) {
        expect(normalisePhone(input)?.waId).toMatch(/^\d+$/);
      }
    });
  });

  describe('rejects what it cannot interpret', () => {
    it('returns null for empty and whitespace-only input', () => {
      expect(normalisePhone('')).toBeNull();
      expect(normalisePhone('   ')).toBeNull();
      expect(normalisePhone('\t\n')).toBeNull();
    });

    it('returns null for input with no usable digits', () => {
      expect(normalisePhone('abc')).toBeNull();
      expect(normalisePhone('+')).toBeNull();
      expect(normalisePhone('---')).toBeNull();
    });

    it('enforces the E.164 length bounds', () => {
      expect(normalisePhone('12345')).toBeNull(); // 5 digits, below the floor
      expect(normalisePhone('+9234567890123456')).toBeNull(); // 16 digits, above
    });

    it('survives a non-string, because untrusted input reaches this function', () => {
      expect(normalisePhone(null as unknown as string)).toBeNull();
      expect(normalisePhone(undefined as unknown as string)).toBeNull();
      expect(normalisePhone(42 as unknown as string)).toBeNull();
      expect(normalisePhone({} as unknown as string)).toBeNull();
    });
  });
});

describe('isValidE164', () => {
  it('accepts a well-formed number', () => {
    expect(isValidE164('+923001234567')).toBe(true);
    expect(isValidE164('+14155550123')).toBe(true);
  });

  it('requires a leading plus', () => {
    expect(isValidE164('923001234567')).toBe(false);
  });

  it('rejects a country code beginning with zero', () => {
    expect(isValidE164('+0300123456')).toBe(false);
  });

  it('enforces 7 to 15 digits', () => {
    expect(isValidE164('+123456')).toBe(false); // 6
    expect(isValidE164('+1234567')).toBe(true); // 7
    expect(isValidE164('+123456789012345')).toBe(true); // 15
    expect(isValidE164('+1234567890123456')).toBe(false); // 16
  });

  it('rejects anything non-numeric, including formatting', () => {
    expect(isValidE164('+92 300 1234567')).toBe(false);
    expect(isValidE164('+92-300-1234567')).toBe(false);
    expect(isValidE164('+92300abc4567')).toBe(false);
  });
});

describe('maskPhone', () => {
  // A phone number is personal data. Audit rows and log lines get the mask.
  it('reveals only the last four digits', () => {
    const masked = maskPhone('+923001234567');
    expect(masked.endsWith('4567')).toBe(true);
    expect(masked).not.toContain('30012');
  });

  it('preserves length, so the shape of the number stays readable', () => {
    expect(maskPhone('+923001234567')).toHaveLength('+923001234567'.length);
  });

  it('keeps the country code, which is not identifying on its own', () => {
    expect(maskPhone('+923001234567').startsWith('+92')).toBe(true);
  });

  it('masks a short value entirely rather than revealing most of it', () => {
    expect(maskPhone('+9234')).toBe('•••••');
    expect(maskPhone('')).toBe('');
  });
});
