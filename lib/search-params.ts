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

/** The shape Next resolves a Server Component's `searchParams` promise to. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a query parameter, or undefined when it is absent or empty. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The filters worth carrying across a navigation inside the same list.
 *
 * A list screen keeps its state in the query string, so paging or clearing a cursor has to
 * rebuild that string minus the part being changed. Every list page had its own loop doing
 * this, and the copies had already begun to disagree about which keys mattered — which is
 * how a filter survives "show more" on one screen and silently resets on another.
 *
 * Keys are named explicitly rather than copied wholesale, so a stray parameter someone
 * appended to a link is dropped instead of propagated.
 */
export function preserveParams(params: SearchParams, keys: readonly string[]): URLSearchParams {
  const preserved = new URLSearchParams();
  for (const key of keys) {
    const value = firstParam(params[key]);
    if (value) preserved.set(key, value);
  }
  return preserved;
}

/** A path with a query string appended only when there is one, so no URL ends in a bare "?". */
export function withParams(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
