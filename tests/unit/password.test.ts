import { describe, expect, it } from 'vitest';

import {
  checkPasswordStrength,
  fakeVerify,
  hashPassword,
  needsRehash,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from '@/server/auth/password';

/** Deliberately weak parameters so the suite is not dominated by key derivation.
 *  The production cost is asserted separately, below. */
const FAST = { N: 1024, r: 8, p: 1 } as const;

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple', FAST);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple', FAST);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('is case sensitive', async () => {
    const hash = await hashPassword('Karachi Kurta 2026', FAST);
    expect(await verifyPassword('karachi kurta 2026', hash)).toBe(false);
  });

  it('salts each hash, so identical passwords produce different records', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password here', FAST),
      hashPassword('same password here', FAST),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password here', a)).toBe(true);
    expect(await verifyPassword('same password here', b)).toBe(true);
  });

  it('encodes its parameters so old hashes stay verifiable', async () => {
    const hash = await hashPassword('parameters in the hash', FAST);
    expect(hash.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
  });

  it('uses a 64 MiB cost by default', async () => {
    const hash = await hashPassword('default cost parameters');
    expect(hash.startsWith('scrypt$65536$8$1$')).toBe(true);
    expect(await verifyPassword('default cost parameters', hash)).toBe(true);
  });

  /**
   * A password typed on macOS may arrive as decomposed Unicode and the same
   * password typed on Windows as composed. Without normalisation the user is
   * locked out of their own account by their choice of operating system.
   */
  it('treats canonically equivalent Unicode as the same password', async () => {
    const composed = 'café-kurta-2026';
    const decomposed = 'café-kurta-2026';
    expect(composed).not.toBe(decomposed);

    const hash = await hashPassword(composed, FAST);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it('handles a long password without truncating it', async () => {
    const long = 'a-very-long-passphrase-'.repeat(10);
    const hash = await hashPassword(long, FAST);
    expect(await verifyPassword(long, hash)).toBe(true);
    expect(await verifyPassword(long.slice(0, -1), hash)).toBe(false);
  });
});

describe('password hashing rejects malformed stored hashes', () => {
  const malformed = [
    '',
    'not-a-hash',
    'scrypt$1024$8$1$onlyfiveparts',
    'bcrypt$1024$8$1$c2FsdA==$aGFzaA==',
    'scrypt$abc$8$1$c2FsdA==$aGFzaA==',
    'scrypt$1024$8$1$$aGFzaA==',
  ];

  for (const hash of malformed) {
    it(`returns false rather than throwing for ${JSON.stringify(hash)}`, async () => {
      expect(await verifyPassword('anything', hash)).toBe(false);
    });
  }

  /**
   * A hash-column write primitive must not become a memory-exhaustion primitive.
   * An absurd N is refused at parse time rather than handed to scrypt.
   */
  it('refuses an absurd cost parameter instead of allocating for it', async () => {
    const hostile = 'scrypt$536870912$32$16$c2FsdHNhbHQ=$' + 'A'.repeat(88);
    const start = Date.now();
    expect(await verifyPassword('anything', hostile)).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('needsRehash', () => {
  it('flags a hash produced with weaker parameters', async () => {
    const weak = await hashPassword('upgrade me please', FAST);
    expect(needsRehash(weak)).toBe(true);
  });

  it('leaves a current hash alone', async () => {
    const current = await hashPassword('already current', FAST);
    expect(needsRehash(current, FAST)).toBe(false);
  });

  it('treats an unreadable hash as needing replacement', () => {
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('fakeVerify', () => {
  /**
   * Instruction: a missing account must not be distinguishable from a wrong
   * password by response time. The two paths are compared directly.
   */
  it('costs about as much as a real verification', async () => {
    const hash = await hashPassword('timing comparison', FAST);

    const realStart = process.hrtime.bigint();
    await verifyPassword('wrong password entirely', hash);
    const realNs = Number(process.hrtime.bigint() - realStart);

    const fakeStart = process.hrtime.bigint();
    await fakeVerify(FAST);
    const fakeNs = Number(process.hrtime.bigint() - fakeStart);

    // Same order of magnitude is the property that matters; exact parity is not
    // achievable and not required to close the oracle.
    const ratio = fakeNs / realNs;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(5);
  });
});

describe('password policy', () => {
  it(`requires at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(checkPasswordStrength('short').valid).toBe(false);
    expect(checkPasswordStrength('a'.repeat(PASSWORD_MIN_LENGTH - 1)).valid).toBe(false);
    expect(checkPasswordStrength('kurta shop karachi').valid).toBe(true);
  });

  it('accepts a long passphrase with no symbols or digits', () => {
    // Length buys entropy. Character-class rules push people to "Password1!".
    expect(checkPasswordStrength('my favourite kurta is the navy one').valid).toBe(true);
  });

  it('rejects a single repeated character', () => {
    expect(checkPasswordStrength('aaaaaaaaaaaaaaaa').valid).toBe(false);
  });

  it('rejects well-known passwords', () => {
    expect(checkPasswordStrength('password1234').valid).toBe(false);
    expect(checkPasswordStrength('PASSWORD1234').valid).toBe(false);
  });

  it('rejects a password containing the email local part', () => {
    expect(checkPasswordStrength('ahmed-raza-store', 'ahmed@akmalfashion.pk').valid).toBe(false);
    // Too short a local part would reject far too much.
    expect(checkPasswordStrength('ali-is-a-great-name', 'ali@akmalfashion.pk').valid).toBe(true);
  });

  it('rejects an over-long password rather than silently truncating it', () => {
    expect(checkPasswordStrength('a'.repeat(300)).valid).toBe(false);
  });

  it('explains itself in language a shop owner can act on', () => {
    const result = checkPasswordStrength('short');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/characters/);
      expect(result.reason).not.toMatch(/entropy|regex|policy violation/i);
    }
  });
});
