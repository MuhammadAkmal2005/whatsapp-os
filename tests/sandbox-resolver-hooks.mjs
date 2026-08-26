/**
 * The resolve hook itself. See `sandbox-resolver.mjs` for why this exists.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

/**
 * Bare specifiers that have no runtime behaviour worth reproducing. `server-only`
 * is a bundler-time guard, so a no-op module is a faithful stand-in.
 */
const STUBS = {
  vitest: 'tests/vitest-shim.mjs',
  'server-only': 'tests/stubs/server-only.mjs',
  'client-only': 'tests/stubs/server-only.mjs',
};

function firstExisting(basePath) {
  for (const extension of EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = resolvePath(basePath, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier];
  if (stub) {
    return { url: pathToFileURL(resolvePath(PROJECT_ROOT, stub)).href, shortCircuit: true };
  }

  // `@/foo/bar` → <project root>/foo/bar
  if (specifier.startsWith('@/')) {
    const resolved = firstExisting(resolvePath(PROJECT_ROOT, specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  // Relative specifier with no extension.
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : PROJECT_ROOT;
    const resolved = firstExisting(resolvePath(parentPath, specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
