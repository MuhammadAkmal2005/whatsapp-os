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

/**
 * Every mock `vi.fn()` hands out, so `vi.clearAllMocks()` has something to clear.
 * Strong references are intentional: the set lives exactly as long as the test
 * process, and a weak set could not be iterated.
 */
const createdMocks = new Set();

/**
 * Vitest's `expect.objectContaining` family. These are placeholders that appear
 * *inside* an expected value and decide for themselves whether the corresponding
 * received value matches, so equality has to ask them rather than compare them.
 */
class AsymmetricMatcher {
  constructor(label, predicate) {
    this.label = label;
    this.predicate = predicate;
  }

  asymmetricMatch(actual) {
    return this.predicate(actual);
  }

  toString() {
    return this.label;
  }

  toJSON() {
    return this.label;
  }
}

/**
 * Structural equality that understands asymmetric matchers.
 *
 * Objects and arrays are walked here so a matcher nested at any depth gets a say;
 * everything else — dates, regexps, maps, sets, prototypes, primitives — is handed
 * to `assert.deepStrictEqual`, which already gets the edge cases right. Hand-rolling
 * that part would only introduce disagreements with the real runner.
 */
function deepMatches(actual, expected) {
  if (expected instanceof AsymmetricMatcher) return expected.asymmetricMatch(actual);

  if (Array.isArray(expected) && Array.isArray(actual)) {
    return (
      expected.length === actual.length &&
      expected.every((value, index) => deepMatches(actual[index], value))
    );
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    const expectedKeys = Object.keys(expected);
    if (expectedKeys.length !== Object.keys(actual).length) return false;
    return expectedKeys.every((key) => key in actual && deepMatches(actual[key], expected[key]));
  }

  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value) || value instanceof Date || value instanceof RegExp) return false;
  if (value instanceof Map || value instanceof Set) return false;
  return true;
}

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

/**
 * The recorded calls of a `vi.fn()`. Fails loudly on anything else, because
 * `expect(realFunction).toHaveBeenCalled()` passing vacuously is the kind of test
 * that reports green for years while asserting nothing.
 */
function mockCalls(value) {
  const calls = value?.mock?.calls;
  if (!Array.isArray(calls)) fail('expected a vi.fn() mock');
  return calls;
}

/**
 * Recursive subset comparison for `toMatchObject`: every key the expectation
 * names must match, and keys it does not name are ignored. Returns the path of
 * the first mismatch so a failure says *which* key was wrong rather than dumping
 * two objects and leaving the reader to diff them.
 */
function findSubsetMismatch(actual, expected, path) {
  if (expected instanceof RegExp) {
    return expected.test(String(actual)) ? null : `${path || 'value'} did not match ${expected}`;
  }

  if (expected === null || typeof expected !== 'object') {
    return Object.is(actual, expected)
      ? null
      : `${path || 'value'}: ${stringify(actual)} !== ${stringify(expected)}`;
  }

  if (actual === null || typeof actual !== 'object') {
    return `${path || 'value'} is ${stringify(actual)}, expected an object`;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path || 'value'} is not an array`;
    if (actual.length !== expected.length) {
      return `${path || 'value'} has length ${actual.length}, expected ${expected.length}`;
    }
  }

  for (const key of Object.keys(expected)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in actual)) return `${childPath} is missing`;
    const mismatch = findSubsetMismatch(actual[key], expected[key], childPath);
    if (mismatch !== null) return mismatch;
  }

  return null;
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
      check(
        deepMatches(actual, expected),
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
    toMatchObject(expected) {
      const mismatch = findSubsetMismatch(actual, expected, '');
      check(
        mismatch === null,
        `expected ${stringify(actual)} to match object ${stringify(expected)}${mismatch ? ` (${mismatch})` : ''}`,
        `expected ${stringify(actual)} not to match object ${stringify(expected)}`,
      );
    },
    toHaveBeenCalled() {
      const calls = mockCalls(actual);
      check(
        calls.length > 0,
        'expected mock to have been called',
        'expected mock not to have been called',
      );
    },
    toHaveBeenCalledTimes(expected) {
      const calls = mockCalls(actual);
      check(
        calls.length === expected,
        `expected mock to have been called ${expected} time(s), got ${calls.length}`,
        `expected mock not to have been called ${expected} time(s)`,
      );
    },
    toHaveBeenCalledWith(...expected) {
      const calls = mockCalls(actual);
      const passed = calls.some((call) => deepMatches(call, expected));
      check(
        passed,
        `expected mock to have been called with ${stringify(expected)}; calls were ${stringify(calls)}`,
        `expected mock not to have been called with ${stringify(expected)}`,
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

  /**
   * `rejects` always requires the promise to reject — that is the point of the
   * modifier. `.not` negates the *match against the reason*, not the rejection
   * itself, which is what makes `rejects.not.toThrow(secret)` the natural way to
   * assert that a secret was redacted from an error message.
   */
  matchers.rejects = {
    async toThrow(expected) {
      const thrown = await captureRejection(actual);
      if (!thrown) fail('expected promise to reject, but it resolved');
      assertThrownMatches(thrown, expected);
    },
    not: {
      async toThrow(expected) {
        const thrown = await captureRejection(actual);
        if (!thrown) fail('expected promise to reject, but it resolved');
        if (expected === undefined) {
          fail('rejects.not.toThrow() with no argument asserts nothing — pass a matcher');
        }
        let matched = true;
        try {
          assertThrownMatches(thrown, expected);
        } catch {
          matched = false;
        }
        if (matched) {
          fail(`expected rejection ${stringify(thrown)} not to match ${stringify(expected)}`);
        }
      },
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

async function captureRejection(value) {
  try {
    await (typeof value === 'function' ? value() : value);
    return undefined;
  } catch (error) {
    // A `throw undefined` would otherwise read as "did not reject".
    return error ?? new Error('non-error throw');
  }
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

expect.anything = () =>
  new AsymmetricMatcher('Anything', (actual) => actual !== null && actual !== undefined);

expect.any = (constructor) =>
  new AsymmetricMatcher(`Any<${constructor?.name ?? 'unknown'}>`, (actual) => {
    switch (constructor) {
      case String:
        return typeof actual === 'string' || actual instanceof String;
      case Number:
        return typeof actual === 'number' || actual instanceof Number;
      case Boolean:
        return typeof actual === 'boolean' || actual instanceof Boolean;
      case BigInt:
        return typeof actual === 'bigint';
      case Symbol:
        return typeof actual === 'symbol';
      case Function:
        return typeof actual === 'function';
      case Object:
        return actual !== null && typeof actual === 'object';
      default:
        return actual instanceof constructor;
    }
  });

expect.stringContaining = (substring) =>
  new AsymmetricMatcher(
    `StringContaining<${stringify(substring)}>`,
    (actual) => typeof actual === 'string' && actual.includes(substring),
  );

expect.stringMatching = (pattern) => {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return new AsymmetricMatcher(
    `StringMatching<${regex}>`,
    (actual) => typeof actual === 'string' && regex.test(actual),
  );
};

/** Subset match: the named keys must match, unnamed keys are ignored. */
expect.objectContaining = (expected) =>
  new AsymmetricMatcher(
    `ObjectContaining<${stringify(expected)}>`,
    (actual) =>
      actual !== null &&
      typeof actual === 'object' &&
      Object.keys(expected).every(
        (key) => key in actual && deepMatches(actual[key], expected[key]),
      ),
  );

/** Containment, not equality: order is free and extra elements are allowed. */
expect.arrayContaining = (expected) =>
  new AsymmetricMatcher(
    `ArrayContaining<${stringify(expected)}>`,
    (actual) =>
      Array.isArray(actual) &&
      expected.every((value) => actual.some((element) => deepMatches(element, value))),
  );

export const test = it;
export { after, afterEach, before, beforeEach, describe, it };
export const vi = {
  fn(implementation) {
    let impl = implementation;
    const calls = [];
    // One-shot implementations, consumed in FIFO order before falling back to the
    // persistent one. This is what lets a test say "first call resolves, second
    // rejects" — the pattern the retry and failover tests are built on.
    const onceQueue = [];
    const mock = (...args) => {
      calls.push(args);
      const next = onceQueue.length > 0 ? onceQueue.shift() : impl;
      return next?.(...args);
    };
    mock.mock = { calls };
    mock.mockImplementation = (next) => {
      impl = next;
      return mock;
    };
    mock.mockReturnValue = (value) => mock.mockImplementation(() => value);
    // Constructed per call, not once: a rejected promise created at configuration
    // time and never awaited is an unhandled rejection that fails the whole file.
    mock.mockResolvedValue = (value) => mock.mockImplementation(() => Promise.resolve(value));
    mock.mockRejectedValue = (error) => mock.mockImplementation(() => Promise.reject(error));
    mock.mockImplementationOnce = (next) => {
      onceQueue.push(next);
      return mock;
    };
    mock.mockReturnValueOnce = (value) => mock.mockImplementationOnce(() => value);
    mock.mockResolvedValueOnce = (value) => mock.mockImplementationOnce(() => Promise.resolve(value));
    mock.mockRejectedValueOnce = (error) => mock.mockImplementationOnce(() => Promise.reject(error));
    mock.mockClear = () => {
      calls.length = 0;
      return mock;
    };
    mock.mockReset = () => {
      calls.length = 0;
      onceQueue.length = 0;
      impl = implementation;
      return mock;
    };
    createdMocks.add(mock);
    return mock;
  },
  /**
   * Clears recorded calls on every mock this shim created, which is what the
   * `beforeEach` hooks in the suite expect. It deliberately does not discard
   * implementations — that is `resetAllMocks` in Vitest, and conflating the two
   * would silently strip the setup a test did outside its `beforeEach`.
   */
  clearAllMocks() {
    for (const mock of createdMocks) mock.mockClear();
  },
  resetAllMocks() {
    for (const mock of createdMocks) mock.mockReset();
  },
};
