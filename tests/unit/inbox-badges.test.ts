import { describe, expect, it } from 'vitest';

/**
 * Formatters used by the inbox.
 *
 * These four functions used to live inside `components/inbox/conversation-badges.tsx`. They
 * are pure, several other screens wanted them, and one of them — the compact relative
 * timestamp — shared a name with a differently-behaving function elsewhere, which made an
 * import look interchangeable when it was not. They now live in `lib/datetime.ts` and
 * `lib/names.ts`; this file follows them and covers more than it did before.
 *
 * Two contract changes are asserted deliberately rather than papered over:
 *
 * `now` is injectable, so every assertion below is pinned to a fixed instant instead of
 * reading the wall clock. The previous versions of these tests measured against
 * `new Date()`, which is why they could only check coarse values.
 *
 * `initials` returns an en dash for an absent name, not "??". Four copies of this function
 * had drifted to three different fallbacks; the surviving one is documented in `lib/names.ts`
 * and this is the behaviour the avatars now show.
 */

import {
  formatDayDivider,
  formatRelativeTimeCompact,
  formatTimeOfDay,
} from '@/lib/datetime';
import { initials } from '@/lib/names';

/** A Friday, mid-afternoon, chosen so day arithmetic never crosses a month or year edge. */
const NOW = new Date(2026, 7, 28, 15, 0, 0);

const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const hoursBefore = (hours: number) => minutesBefore(hours * 60);
const daysBefore = (days: number) => hoursBefore(days * 24);

describe('initials', () => {
  it('takes the first and last word of a multi-word name', () => {
    expect(initials('Ahmed Raza')).toBe('AR');
    expect(initials('Muhammad Bilal Khan')).toBe('MK');
  });

  it('takes two letters from a single-word name, not one', () => {
    // Single-word names are common in Pakistan, and a one-letter avatar reads as a bug.
    expect(initials('Ahmed')).toBe('AH');
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(initials('   Fatima   Sheikh  ')).toBe('FS');
  });

  it('falls back to an en dash when there is no name', () => {
    expect(initials('')).toBe('–');
    expect(initials('   ')).toBe('–');
    expect(initials(null)).toBe('–');
    expect(initials(undefined)).toBe('–');
  });
});

describe('formatRelativeTimeCompact', () => {
  it('collapses anything under a minute to "Just now"', () => {
    expect(formatRelativeTimeCompact(NOW, NOW)).toBe('Just now');
    expect(formatRelativeTimeCompact(new Date(NOW.getTime() - 59_000), NOW)).toBe('Just now');
  });

  it('never renders a negative duration', () => {
    // A queued row or a skewed clock must not appear as "-4m" in the list.
    expect(formatRelativeTimeCompact(new Date(NOW.getTime() + 5 * 60_000), NOW)).toBe('Just now');
  });

  it('counts minutes up to an hour', () => {
    expect(formatRelativeTimeCompact(minutesBefore(5), NOW)).toBe('5m');
    expect(formatRelativeTimeCompact(minutesBefore(59), NOW)).toBe('59m');
  });

  it('counts hours up to a day', () => {
    expect(formatRelativeTimeCompact(hoursBefore(1), NOW)).toBe('1h');
    expect(formatRelativeTimeCompact(hoursBefore(3), NOW)).toBe('3h');
    expect(formatRelativeTimeCompact(hoursBefore(23), NOW)).toBe('23h');
  });

  it('names yesterday, then counts days up to a week', () => {
    expect(formatRelativeTimeCompact(daysBefore(1), NOW)).toBe('Yesterday');
    expect(formatRelativeTimeCompact(daysBefore(4), NOW)).toBe('4d');
    expect(formatRelativeTimeCompact(daysBefore(6), NOW)).toBe('6d');
  });

  it('switches to a date beyond a week, and adds the year only when it differs', () => {
    const lastMonth = formatRelativeTimeCompact(daysBefore(30), NOW);
    expect(lastMonth).toMatch(/Jul/);
    expect(lastMonth).not.toMatch(/2026/);

    const lastYear = formatRelativeTimeCompact(new Date(2025, 10, 3), NOW);
    expect(lastYear).toMatch(/2025/);
  });
});

describe('formatDayDivider', () => {
  it('names today and yesterday', () => {
    expect(formatDayDivider(new Date(2026, 7, 28, 9, 15), NOW)).toBe('Today');
    expect(formatDayDivider(new Date(2026, 7, 27, 22, 40), NOW)).toBe('Yesterday');
  });

  it('compares calendar days, not elapsed hours', () => {
    // 23:30 yesterday and 00:30 today are an hour apart but belong to different days —
    // the reason the implementation truncates to the start of the day before subtracting.
    const justBeforeMidnight = new Date(2026, 7, 27, 23, 30);
    const justAfterMidnight = new Date(2026, 7, 28, 0, 30);

    expect(formatDayDivider(justBeforeMidnight, justAfterMidnight)).toBe('Yesterday');
    expect(formatDayDivider(justAfterMidnight, justAfterMidnight)).toBe('Today');
  });

  it('gives a weekday and date for anything older', () => {
    const label = formatDayDivider(new Date(2026, 7, 21), NOW);
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label).toMatch(/Aug/);
  });

  it('adds the year only when it differs from now', () => {
    expect(formatDayDivider(new Date(2026, 2, 4), NOW)).not.toMatch(/2026/);
    expect(formatDayDivider(new Date(2025, 2, 4), NOW)).toMatch(/2025/);
  });
});

describe('formatTimeOfDay', () => {
  it('formats the clock time with a two-digit minute', () => {
    expect(formatTimeOfDay(new Date(2026, 7, 28, 14, 30))).toMatch(/2:30/);
    expect(formatTimeOfDay(new Date(2026, 7, 28, 9, 5))).toMatch(/9:05/);
  });
});
