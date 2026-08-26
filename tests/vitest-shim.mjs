/**
 * A minimal `vitest` stand-in backed by `node:test`.
 *
 * The test suite is written against Vitest, which is the canonical runner. This
 * shim lets the same test files execute under bare `node --test` in an
 * environment where `node_modules` cannot be installed, so the assertions below
 * are genuinely executed rather than assumed to pass.
 *
 * It implements only the matchers the suite actually uses. Anything missing
 * throws loudly rather than silently passing — a matcher that quietly no-ops is
 * worse than no test at all.
 */

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

class ExpectationError extends Error {}

function fail(message) {
  throw new ExpectationError(message);
}

function stringify(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function buildMatchers(actual, negated) {
  const check = (passed, message, negatedMessage) => {
    if (negated ? passed : !passed) {
      fail(negated ? negatedMessage : message);
    }
  };

  const matchers = {
    toBe(expected) {
      check(
        Object.is(actual, expected),
        `expected ${stringify(actual)} to be ${stringify(expected)}`,
        `expected ${stringify(actual)} not to be ${stringify(expected)}`,
      );
    },
    toEqual(expected) {
      let passed = true;
      try {
        assert.deepStrictEqual(actual, expected);
      } catch {
        passed = false;
      }
      check(
        passed,
        `expected ${stringify(actual)} to equal ${stringify(expected)}`,
        `expected ${stringify(actual)} not to equal ${stringify(expected)}`,
      );
    },
    toStrictEqual(expected) {
      matchers.toEqual(expected);
    },
    toBeTruthy() {
      check(Boolean(actual), `expected ${stringify(actual)} to be truthy`, `expected ${stringify(actual)} to be falsy`);
    },
    toBeFalsy() {
      check(!actual, `expected ${stringify(actual)} to be falsy`, `expected ${stringify(actual)} to be truthy`);
    },
    toBeNull() {
      check(actual === null, `expected ${stringify(actual)} to be null`, `expected value not to be null`);
    },
    toBeUndefined() {
      check(actual === undefined, `expected ${stringify(actual)} to be undefined`, `expected value not to be undefined`);
    },
    toBeDefined() {
      check(actual !== undefined, `expected value to be defined`, `expected value to be undefined`);
    },
    toBeInstanceOf(expected) {
      check(
        actual instanceof expected,
        `expected ${stringify(actual)} to be an instance of ${expected.name}`,
        `expected value not to be an instance of ${expected.name}`,
      );
    },
    toContain(expected) {
      const passed = typeof actual === 'string'
        ? actual.includes(expected)
        : Array.isArray(actual) || actual instanceof Set
          ? [...actual].includes(expected)
          : false;
      check(
        passed,
        `expected ${stringify(actual)} to contain ${stringify(expected)}`,
        `expected ${stringify(actual)} not to contain ${stringify(expected)}`,
      );
    },
    toHaveLength(expected) {
      check(
        actual?.length === expected,
        `expected length ${actual?.length} to be ${expected}`,
        `expected length not to be ${expected}`,
      );
    },
    toBeGreaterThan(expected) {
      check(actual > expected, `expected ${actual} > ${expected}`, `expected ${actual} not > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      check(actual >= expected, `expected ${actual} >= ${expected}`, `expected ${actual} not >= ${expected}`);
    },
    toBeLessThan(expected) {
      check(actual < expected, `expected ${actual} < ${expected}`, `expected ${actual} not < ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      check(actual <= expected, `expected ${actual} <= ${expected}`, `expected ${actual} not <= ${expected}`);
    },
    toBeCloseTo(expected, precision = 2) {
      const passed = Math.abs(actual - expected) < 10 ** -precision / 2;
      check(passed, `expected ${actual} to be close to ${expected}`, `expected ${actual} not to be close to ${expected}`);
    },
    toMatch(pattern) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      check(
        regex.test(String(actual)),
        `expected ${stringify(actual)} to match ${regex}`,
        `expected ${stringify(actual)} not to match ${regex}`,
      );
    },
    toThrow(expected) {
      if (typeof actual !== 'function') fail('toThrow expects a function');
      let thrown;
      try {
        actual();
      } catch (error) {
        thrown = error ?? new Error('non-error throw');
      }
      if (negated) {
        if (thrown) fail(`expected function not to throw, but it threw ${stringify(thrown)}`);
        return;
      }
      if (!thrown) fail('expected function to throw, but it did not');
      assertThrownMatches(thrown, expected);
    },
  };

  matchers.rejects = {
    async toThrow(expected) {
      const promise = typeof actual === 'function' ? actual() : actual;
      let thrown;
      try {
        await promise;
      } catch (error) {
        thrown = error ?? new Error('non-error throw');
      }
      if (negated) {
        if (thrown) fail(`expected promise not to reject, but it rejected with ${stringify(thrown)}`);
        return;
      }
      if (!thrown) fail('expected promise to reject, but it resolved');
      assertThrownMatches(thrown, expected);
    },
  };

  matchers.resolves = {
    async toBe(expected) {
      const value = await (typeof actual === 'function' ? actual() : actual);
      buildMatchers(value, negated).toBe(expected);
    },
    async toEqual(expected) {
      const value = await (typeof actual === 'function' ? actual() : actual);
      buildMatchers(value, negated).toEqual(expected);
    },
  };

  return matchers;
}

function assertThrownMatches(thrown, expected) {
  if (expected === undefined) return;
  if (typeof expected === 'function') {
    if (!(thrown instanceof expected)) {
      fail(`expected throw to be ${expected.name}, got ${stringify(thrown)}`);
    }
    return;
  }
  if (expected instanceof RegExp) {
    if (!expected.test(thrown.message ?? String(thrown))) {
      fail(`expected error message ${stringify(thrown.message)} to match ${expected}`);
    }
    return;
  }
  if (typeof expected === 'string' && !(thrown.message ?? '').includes(expected)) {
    fail(`expected error message ${stringify(thrown.message)} to contain ${stringify(expected)}`);
  }
}

export function expect(actual) {
  const matchers = buildMatchers(actual, false);
  matchers.not = buildMatchers(actual, true);
  return matchers;
}

expect.fail = fail;

export const test = it;
export { after, afterEach, before, beforeEach, describe, it };
export const vi = {
  fn(implementation) {
    const calls = [];
    const mock = (...args) => {
      calls.push(args);
      return implementation?.(...args);
    };
    mock.mock = { calls };
    return mock;
  },
};
