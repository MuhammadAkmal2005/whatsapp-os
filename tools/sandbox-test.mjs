/**
 * Sandbox test runner.
 *
 * `npm test` (Vitest) is the canonical runner and needs `node_modules`. This runs
 * the same test files under bare `node --test` for environments where the package
 * registry is unreachable, so the suite is genuinely executed rather than assumed.
 *
 * The subtlety it exists to handle: some tests transitively import a third-party
 * package — Zod, mostly — which simply is not there. Those tests cannot run, and
 * the two dishonest ways to deal with that are pretending they passed, or stubbing
 * the package so the test grades a stub instead of the real validator.
 *
 * So each file is run in its own process and its outcome classified:
 *
 *   PASS     — ran, assertions held.
 *   FAIL     — ran, assertions did not hold. Exits non-zero.
 *   SKIPPED  — could not load because a package is missing. Reported by name, with
 *              the package named, and never counted as success.
 *
 * A skip is a gap in coverage that this environment cannot close, and printing it
 * on every run is what stops it from being forgotten.
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, 'tests', 'unit');
const MISSING_PACKAGE = /Cannot find package '([^']+)'/;

const files = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(TEST_DIR, name));

const passed = [];
const failed = [];
const skipped = [];
let totalAssertions = 0;

for (const file of files) {
  const label = relative(ROOT, file);
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '--import',
      './tests/sandbox-resolver.mjs',
      '--test',
      file,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const missing = output.match(MISSING_PACKAGE);

  if (missing && result.status !== 0) {
    skipped.push([label, missing[1]]);
    process.stdout.write(`SKIP  ${label}  (needs "${missing[1]}" — run under Vitest)\n`);
    continue;
  }

  const count = Number(output.match(/^# pass (\d+)$/m)?.[1] ?? 0);
  totalAssertions += count;

  if (result.status === 0) {
    passed.push(label);
    process.stdout.write(`PASS  ${label}  (${count})\n`);
  } else {
    failed.push(label);
    process.stdout.write(`FAIL  ${label}\n`);
    // Only the failing subtests, so the useful line is not buried in TAP noise.
    for (const line of output.split('\n')) {
      if (/^\s*not ok |^\s+(error|expected|actual):/i.test(line)) {
        process.stdout.write(`      ${line.trim()}\n`);
      }
    }
  }
}

process.stdout.write(
  `\n${passed.length} file(s) passed, ${totalAssertions} test(s) — ` +
    `${failed.length} failed, ${skipped.length} skipped\n`,
);

if (skipped.length > 0) {
  process.stdout.write(
    `\nSkipped because this environment has no package registry. ` +
      `Run "npm install && npm test" to execute them:\n` +
      skipped.map(([label, pkg]) => `  • ${label} → ${pkg}\n`).join(''),
  );
}

process.exit(failed.length === 0 ? 0 : 1);
