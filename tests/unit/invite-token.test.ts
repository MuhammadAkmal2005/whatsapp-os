import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isInviteToken, parseInviteToken } from '@/lib/invite-token';
import { firstParam } from '@/lib/search-params';

/**
 * These two helpers are small, but the first one guards a redirect: the invitation
 * token is concatenated into a path that login, signup and sign-out all send the
 * browser to. So the interesting cases are not "does a real token pass" but "does
 * every way of smuggling a different destination fail".
 */

/** A fixed value in the base64url alphabet, standing in for a generated token. */
const REAL_TOKEN = 'Zm9vYmFyLXRoaXMtaXMtYS1mYWtlLXRva2VuLXZhbHVl';

describe('isInviteToken', () => {
  it('accepts a fixed base64url value', () => {
    expect(REAL_TOKEN).toHaveLength(44);
    expect(isInviteToken(REAL_TOKEN)).toBe(true);
  });

  it('accepts what the token generator actually produces', () => {
    // Generated rather than hard-coded, so the pattern cannot drift out of step
    // with `randomBytes(32).toString('base64url')` without this failing.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(isInviteToken(randomBytes(32).toString('base64url'))).toBe(true);
    }
  });

  it('accepts the hyphen and underscore that base64url substitutes for + and /', () => {
    expect(isInviteToken('abcdefghijklmnop-_')).toBe(true);
  });

  describe('rejects anything that could change a redirect destination', () => {
    // Each of these, if it reached `/invite/${token}` or a Location header,
    // would send the browser somewhere other than this application.
    const hostile = [
      ['a protocol-relative host', '//evil.example/steal'],
      ['an absolute URL', 'https://evil.example/steal'],
      ['a scheme-only prefix', 'https:evil.example'],
      ['parent traversal', '../../dashboard'],
      ['a single dot segment', './dashboard'],
      ['an embedded slash', 'abcdefghijklmnop/../../etc'],
      ['a backslash, which some clients normalise to a slash', 'abcdefghijklmnop\\evil'],
      ['a query string appended to a valid token', `${REAL_TOKEN}?next=//evil.example`],
      ['a fragment appended to a valid token', `${REAL_TOKEN}#//evil.example`],
      ['a percent-encoded slash', 'abcdefghijklmnop%2Fevil'],
      ['an encoded newline for header splitting', 'abcdefghijklmnop%0d%0aLocation:+//evil'],
      ['a literal newline', 'abcdefghijklmnop\nLocation: //evil'],
      ['a null byte', 'abcdefghijklmnop\u0000'],
      ['a dot, which base64url never contains', 'abcdefghij.klmnop'],
      ['a plus and slash from standard base64', 'abcdefgh+ijklmn/op'],
    ] as const;

    for (const [description, value] of hostile) {
      it(description, () => {
        expect(isInviteToken(value)).toBe(false);
      });
    }
  });

  it('rejects a value that is too short to be a real token', () => {
    expect(isInviteToken('abc')).toBe(false);
    expect(isInviteToken('a'.repeat(15))).toBe(false);
    expect(isInviteToken('a'.repeat(16))).toBe(true);
  });

  it('rejects an oversized value before it can reach a database read', () => {
    expect(isInviteToken('a'.repeat(128))).toBe(true);
    expect(isInviteToken('a'.repeat(129))).toBe(false);
  });

  it('rejects an empty string and non-strings', () => {
    expect(isInviteToken('')).toBe(false);
    expect(isInviteToken(null)).toBe(false);
    expect(isInviteToken(undefined)).toBe(false);
    expect(isInviteToken(42)).toBe(false);
    expect(isInviteToken({ toString: () => REAL_TOKEN })).toBe(false);
  });
});

describe('parseInviteToken', () => {
  it('returns the token when the value is well formed', () => {
    expect(parseInviteToken(REAL_TOKEN)).toBe(REAL_TOKEN);
  });

  it('trims whitespace, because a pasted link often carries it', () => {
    expect(parseInviteToken(`  ${REAL_TOKEN}\n`)).toBe(REAL_TOKEN);
  });

  it('does not trim its way to a valid token from a hostile one', () => {
    // Trimming must not become a way to strip meaningful characters — only the
    // outer whitespace goes, and what is left still has to pass the shape check.
    expect(parseInviteToken(`  //evil.example  `)).toBeNull();
    expect(parseInviteToken(` ${REAL_TOKEN}/../x `)).toBeNull();
  });

  it('returns null rather than throwing for absent or wrong-typed input', () => {
    expect(parseInviteToken(null)).toBeNull();
    expect(parseInviteToken(undefined)).toBeNull();
    expect(parseInviteToken('   ')).toBeNull();
  });
});

describe('firstParam', () => {
  it('returns a single string value', () => {
    expect(firstParam('abc')).toBe('abc');
  });

  it('takes the first of a repeated parameter', () => {
    // `?invite=a&invite=b` arrives as an array. Taking the first is a choice, but
    // the important part is that it never returns the array to a caller typed for
    // a string.
    expect(firstParam(['first', 'second'])).toBe('first');
  });

  it('treats absent, empty and whitespace-only values as absent', () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam('')).toBeUndefined();
    expect(firstParam('   ')).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
  });

  it('trims the value it returns', () => {
    expect(firstParam('  abc  ')).toBe('abc');
  });
});
