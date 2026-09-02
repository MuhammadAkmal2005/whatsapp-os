/**
 * Name formatting.
 *
 * One function, in one place, because it had four copies — in the inbox, in the contacts
 * list, in the sidebar account row, and inline in the team settings page — and they had
 * drifted: three different fallbacks for a missing name ("?", "??", "–") and one that
 * returned a single letter for a single-word name while the others returned two. The same
 * customer therefore appeared as "AK" in their conversation and "A" in the sidebar.
 */

/**
 * Up to two letters for an avatar fallback.
 *
 * A single-word name yields its first two letters rather than one, because single-word
 * names are common in Pakistan and a one-letter avatar reads as a truncation bug. An
 * absent name yields an en dash: a circle containing "?" looks like the interface is
 * asking the reader a question.
 */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);

  const first = parts.at(0);
  if (!first) return '–';

  const last = parts.length > 1 ? parts.at(-1) : undefined;
  return (last ? `${first.slice(0, 1)}${last.slice(0, 1)}` : first.slice(0, 2)).toUpperCase();
}
