/**
 * Parse-only gate for the sandboxed environment.
 *
 * `npm run typecheck` is the real gate, but it needs `node_modules`, which cannot
 * be installed where the package registry is unreachable. This walks every
 * TypeScript source file and runs Node's built-in type stripper over it, which
 * catches syntax errors, unbalanced braces, and malformed generics — the class of
 * mistake that would otherwise sit undiscovered until the first real build.
 *
 * It does NOT check types, and it deliberately skips `.tsx`: Node's stripper has no
 * JSX parser, so every component file would report a false failure and the signal
 * would be worthless. Nothing here substitutes for `tsc --noEmit`.
 *
 * It also scans every text file for a literal NUL byte. That sounds obscure, but it
 * has happened four times in this repository — including once in this very comment,
 * which is how the check earned its place: a NUL escape typed as the raw byte
 * instead of the two-character sequence. The file still parses, so nothing
 * complains, but grep classifies it as binary and silently skips it from then on.
 * A source file can therefore drop out of every subsequent search, including a
 * security audit. Cheap to detect, expensive to miss.
 *
 * Usage: node tools/syntax-check.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', '.turbo', '.storage']);
const EXTENSIONS = new Set(['.ts', '.mts']);

/** Everything we expect to be plain text, for the NUL scan. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.md',
  '.prisma',
  '.yml',
  '.yaml',
  '.css',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(ROOT).sort();
const files = allFiles.filter((file) => EXTENSIONS.has(extname(file)));
const textFiles = allFiles.filter((file) => TEXT_EXTENSIONS.has(extname(file)));
const failures = [];
const binary = [];

for (const file of textFiles) {
  const bytes = readFileSync(file);
  const at = bytes.indexOf(0);
  if (at !== -1) {
    binary.push([relative(ROOT, file), at]);
  }
}

for (const file of files) {
  try {
    stripTypeScriptTypes(readFileSync(file, 'utf8'), {
      mode: 'strip',
      sourceMap: false,
      sourceUrl: file,
    });
  } catch (error) {
    failures.push([relative(ROOT, file), String(error.message).split('\n').slice(0, 3).join(' ')]);
  }
}

for (const [file, message] of failures) {
  process.stdout.write(`FAIL  ${file}\n      ${message}\n`);
}

for (const [file, offset] of binary) {
  process.stdout.write(
    `FAIL  ${file}\n      literal NUL byte at offset ${offset}. Write '\\u0000' instead.\n`,
  );
}

const problems = failures.length + binary.length;

process.stdout.write(
  problems === 0
    ? `syntax ok — ${files.length} TypeScript files parsed, ${textFiles.length} text files scanned for NUL bytes\n`
    : `\n${problems} problem(s): ${failures.length} parse failure(s), ${binary.length} file(s) with NUL bytes\n`,
);

process.exit(problems === 0 ? 0 : 1);
