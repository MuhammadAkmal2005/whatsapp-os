/**
 * Module resolution hook for running the unit tests under bare `node --test`.
 *
 * Application source uses the `@/…` path alias and extensionless imports, which
 * is what Next.js and Vitest expect. Node's ESM resolver understands neither, so
 * this hook teaches it both: it maps the alias to the project root and appends
 * `.ts` (or `/index.ts`) when the specifier has no extension.
 *
 * This exists purely so the domain-logic tests can be executed in an environment
 * without `node_modules` — a real test run, not a simulated one. `npm test`
 * (Vitest) remains the canonical runner and needs none of this.
 *
 * Usage: node --import ./tests/sandbox-resolver.mjs --test tests/unit/*.test.ts
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./sandbox-resolver-hooks.mjs', pathToFileURL(import.meta.filename));
