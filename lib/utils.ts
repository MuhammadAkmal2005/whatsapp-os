/**
 * Small, dependency-light helpers shared across the UI.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names and resolves Tailwind conflicts.
 *
 * `clsx` handles conditionals and arrays; `tailwind-merge` then makes the last
 * conflicting utility win, so a caller can pass `cn('px-2', condition && 'px-4')`
 * and get `px-4` rather than two competing paddings. Without the merge step the
 * order of utilities in the final string would decide the winner, which is not
 * something a component author should have to reason about.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
