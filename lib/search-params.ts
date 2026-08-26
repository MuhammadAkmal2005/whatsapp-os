/**
 * Reading query parameters.
 *
 * Next hands a repeated parameter over as an array, so every read has to cope with
 * both shapes. Doing that at each call site is where "sometimes a string, sometimes
 * an array" bugs come from; this collapses it once.
 *
 * Pure and dependency-free, so it is safe to import from a Server Component, a
 * Client Component or a test.
 */

/** The first value of a query parameter, or undefined when it is absent or empty. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
