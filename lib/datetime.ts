/**
 * Human-friendly date and time formatting.
 *
 * Pure and dependency-free, so it is unit-testable without a bundler and safe to
 * import anywhere. Relative strings are computed against an injectable `now` so
 * the output is deterministic in tests; in a Server Component the value is
 * rendered once on the server, so there is no client re-computation to drift.
 */

type Division = { readonly amount: number; readonly unit: Intl.RelativeTimeFormatUnit };

/** Each step's `amount` is how many of the *current* unit make up the next one. */
const DIVISIONS: readonly Division[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/**
 * "2 hours ago", "in 3 days", "just now". Uses `Intl.RelativeTimeFormat` with
 * `numeric: 'auto'` so near-present values read as words ("yesterday") rather
 * than "1 day ago". Negative durations are past, positive are future.
 */
export function formatRelativeTime(date: Date, now: Date = new Date(), locale = 'en'): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let duration = (date.getTime() - now.getTime()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatter.format(Math.round(duration), 'year');
}

/** An absolute, unambiguous timestamp for tooltips and detail views. */
export function formatDateTime(date: Date, locale = 'en-PK'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Date only — for anything where the clock time is noise. */
export function formatDate(date: Date, locale = 'en-PK'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
