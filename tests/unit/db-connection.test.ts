/**
 * Unit tests for the derived database connection facts.
 *
 * Why this is worth testing: it feeds an operational endpoint that an operator will
 * use to decide whether to set `connection_limit` or `pgbouncer=true` on the live
 * database URL. A wrong boolean sends someone to change production configuration
 * for no reason. And because the function is handed a string containing a password,
 * it has to be shown to emit only booleans and numbers.
 *
 * The lifecycle half of the module — `warmUpDatabase` — is deliberately not
 * imported here. It owns the Prisma client, and a pure-string test has no business
 * loading a query engine to check URL parsing.
 *
 * All URLs below are fictional.
 */

import { describe, expect, it } from 'vitest';

import { deriveConnectionFacts } from '@/db/connection-facts';

const NEON_POOLED =
  'postgresql://app_user:fake_password@ep-example-12345-pooler.us-east-2.aws.neon.tech/appdb?sslmode=require';
const NEON_DIRECT =
  'postgresql://app_user:fake_password@ep-example-12345.us-east-2.aws.neon.tech/appdb?sslmode=require';

describe('deriveConnectionFacts', () => {
  it('detects Neon pooled endpoints by the -pooler host label', () => {
    expect(deriveConnectionFacts(NEON_POOLED, 2).pooled).toBe(true);
    expect(deriveConnectionFacts(NEON_DIRECT, 2).pooled).toBe(false);
  });

  it('reports pgbouncer and connection_limit only when explicitly set', () => {
    const bare = deriveConnectionFacts(NEON_POOLED, 2);
    expect(bare.pgbouncerFlag).toBe(false);
    expect(bare.connectionLimit).toBeNull();

    const tuned = deriveConnectionFacts(
      `${NEON_POOLED}&pgbouncer=true&connection_limit=10`,
      2,
    );
    expect(tuned.pgbouncerFlag).toBe(true);
    expect(tuned.connectionLimit).toBe(10);
  });

  it('treats a non-numeric connection_limit as unset rather than as NaN', () => {
    expect(deriveConnectionFacts(`${NEON_POOLED}&connection_limit=abc`, 2).connectionLimit)
      .toBeNull();
  });

  it('surfaces sslmode and echoes the cpu count used for pool sizing', () => {
    const facts = deriveConnectionFacts(NEON_POOLED, 4);
    expect(facts.sslMode).toBe('require');
    expect(facts.cpuCount).toBe(4);
  });

  it('degrades to safe defaults on an unparseable url instead of throwing', () => {
    const facts = deriveConnectionFacts('not-a-url', 1);
    expect(facts).toEqual({
      pooled: false,
      pgbouncerFlag: false,
      connectionLimit: null,
      cpuCount: 1,
      sslMode: null,
    });
  });

  it('never emits any part of the credential', () => {
    const serialized = JSON.stringify(deriveConnectionFacts(NEON_POOLED, 2));
    expect(serialized).not.toContain('fake_password');
    expect(serialized).not.toContain('app_user');
    expect(serialized).not.toContain('neon.tech');
    expect(serialized).not.toContain('appdb');
    expect(serialized).not.toContain('postgresql://');
  });
});
