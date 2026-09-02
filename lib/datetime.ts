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

/**
 * The same idea, compressed to fit a dense list: "Just now", "5m", "3h", "Yesterday",
 * "4d", then a date.
 *
 * The conversation list shows a timestamp on every row inside a 288px column, beside a
 * name and a message preview. "about 3 hours ago" is the widest thing in the row and
 * pushes the preview out, so the list needs the short form — but only the list. Anywhere
 * with room to read uses `formatRelativeTime`, and the two live here together so it is
 * obvious that both exist and which is which. The inbox previously kept its own copy
 * under the same name, which made an import look interchangeable when it was not.
 *
 * `now` is injectable for the same reason as above, and the locale is pinned for a
 * sharper one: this runs in components that are server-rendered and then hydrated, and
 * an unpinned `toLocaleDateString` resolves against Node's ICU default on the server and
 * the browser's locale on the client, so the two passes disagree and React warns.
 */
export function formatRelativeTimeCompact(
  date: Date,
  now: Date = new Date(),
  locale = 'en-PK',
): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // A clock skew or a queued-in-the-future row should not render as "-4m".
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

/** Clock time alone — for a message that already sits under a date divider. */
export function formatTimeOfDay(date: Date, locale = 'en-PK'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/**
 * The label on a message thread's date divider: "Today", "Yesterday", then a weekday and
 * date, with the year only once it stops being obvious.
 */
export function formatDayDivider(date: Date, now: Date = new Date(), locale = 'en-PK'): string {
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

  const daysApart = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (daysApart === 0) return 'Today';
  if (daysApart === 1) return 'Yesterday';

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
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
