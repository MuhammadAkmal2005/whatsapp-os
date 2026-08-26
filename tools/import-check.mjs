/**
 * Import-graph check.
 *
 * `tsc --noEmit` is the real answer, but it cannot run here: this environment has no
 * package registry and therefore no `node_modules`. The gap that leaves is a
 * dangerous one — a renamed or relocated export produces a file that parses cleanly,
 * passes every unit test that does not touch it, and fails only at build time.
 *
 * So this resolves every first-party import in the tree to a real file, and checks
 * that each named binding actually appears as an export of that file. It is a
 * textual check, not a type check: it will not catch a changed signature, and it
 * deliberately says nothing about third-party packages. What it does catch is the
 * class of mistake a refactor makes — a moved constant, a dropped re-export, a
 * mistyped path.
 *
 *   node --no-warnings tools/import-check.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const RESOLVE_ORDER = ['.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** Specifiers that resolve to something other than a source file we can inspect. */
const NON_SOURCE = /\.(css|scss|json|svg|png|jpg|jpeg|webp|woff2?)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function exists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Applies the extension guesses TypeScript would, in the same order. */
function resolveModule(specifier, fromFile) {
  const base = specifier.startsWith('@/')
    ? join(ROOT, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);

  if (exists(base) && SOURCE_EXTENSIONS.some((ext) => base.endsWith(ext))) return base;
  for (const suffix of RESOLVE_ORDER) {
    const candidate = base + suffix;
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Import statements and the bindings they pull in.
 *
 * Regex rather than a parser because Node can strip TypeScript but not hand back an
 * AST. Import syntax is regular enough at the top of a module for this to be
 * reliable, and a false negative here only costs us a check we did not have before.
 */
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;

function parseImports(source) {
  const found = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? '';
    if (!specifier) continue;

    const braced = clause.match(/\{([\s\S]*?)\}/);
    const names = braced
      ? braced[1]
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => part.replace(/^type\s+/, ''))
          // `x as y` — the export we must find is `x`.
          .map((part) => (part.split(/\s+as\s+/)[0] ?? part).trim())
          .filter((name) => name !== '' && name !== '*')
      : [];

    // A default or namespace import binds a name we cannot verify textually, and a
    // bare `import './x'` binds nothing; either way the path itself still matters.
    found.push({ specifier, names, wildcard: /\*\s*as\s+/.test(clause) || clause.trim() === '*' });
  }
  return found;
}

const EXPORT_PATTERNS = [
  /export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/g,
  /export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g,
  /export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
  /export\s+(?:declare\s+)?(?:type|interface|enum|namespace)\s+([A-Za-z0-9_$]+)/g,
];

/** Names exported by `file`, following `export * from` one module at a time. */
function exportedNames(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);

  const source = readFileSync(file, 'utf8');
  const names = new Set();

  for (const pattern of EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) names.add(match[1]);
    }
  }

  // `export { a, b as c }` — the binding this module offers is the outward name.
  for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const trimmed = part.trim().replace(/^type\s+/, '');
      if (!trimmed) continue;
      const pieces = trimmed.split(/\s+as\s+/);
      const outward = (pieces.length > 1 ? pieces[1] : pieces[0]) ?? '';
      if (outward) names.add(outward.trim());
    }
  }

  if (/export\s+default/.test(source)) names.add('default');

  // A star re-export makes its target's names ours too.
  for (const match of source.matchAll(/export\s*\*\s*(?:as\s+[A-Za-z0-9_$]+\s*)?from\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (!specifier || (!specifier.startsWith('.') && !specifier.startsWith('@/'))) {
      // Re-exporting a package wholesale means we cannot enumerate the names, so
      // stop checking this module rather than report false failures.
      names.add('*');
      continue;
    }
    const target = resolveModule(specifier, file);
    if (!target) continue;
    for (const name of exportedNames(target, seen)) names.add(name);
  }

  return names;
}

const files = walk(ROOT).sort();
const exportCache = new Map();

function exportsOf(file) {
  let cached = exportCache.get(file);
  if (!cached) {
    cached = exportedNames(file);
    exportCache.set(file, cached);
  }
  return cached;
}

const unresolved = [];
const missing = [];
let checkedImports = 0;
let checkedNames = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const where = relative(ROOT, file).replaceAll('\\', '/');

  for (const { specifier, names, wildcard } of parseImports(source)) {
    const firstParty = specifier.startsWith('.') || specifier.startsWith('@/');
    if (!firstParty || NON_SOURCE.test(specifier)) continue;

    checkedImports += 1;
    const target = resolveModule(specifier, file);
    if (!target) {
      unresolved.push(`${where} → '${specifier}'`);
      continue;
    }
    if (wildcard) continue;

    const available = exportsOf(target);
    if (available.has('*')) continue;

    for (const name of names) {
      checkedNames += 1;
      if (!available.has(name)) {
        missing.push(`${where} → '${specifier}' has no export '${name}'`);
      }
    }
  }
}

if (unresolved.length > 0) {
  console.error(`\nUnresolved imports (${unresolved.length}):`);
  for (const line of unresolved) console.error(`  ✗ ${line}`);
}

if (missing.length > 0) {
  console.error(`\nMissing exports (${missing.length}):`);
  for (const line of missing) console.error(`  ✗ ${line}`);
}

const failures = unresolved.length + missing.length;
if (failures === 0) {
  console.log(
    `imports ok — ${checkedImports} first-party import(s), ${checkedNames} named binding(s) across ${files.length} file(s)`,
  );
} else {
  console.error(`\n${failures} import problem(s). This is a textual check; run "npm run typecheck" for the real one.`);
  process.exitCode = 1;
}
