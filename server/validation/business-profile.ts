/**
 * Business profile shapes.
 *
 * `BusinessProfile.businessHours` is a JSON column, so Prisma returns it as an
 * unknown JSON value and the database guarantees nothing about its shape. It is
 * parsed rather than cast: a row written by an older version of the app, or edited
 * by hand in a SQL client, must not be able to put a malformed object in front of
 * the AI. A blob that does not parse reads as "hours not set", which makes the agent
 * say it does not know rather than state something wrong — the same rule that
 * governs every other business fact it repeats.
 */

import { z } from 'zod';

/**
 * A 24-hour `HH:MM` clock time.
 *
 * A string rather than minutes-since-midnight because it is what a settings form
 * produces and what a shop owner reads back, and because the AI quotes it verbatim.
 */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in 24-hour HH:MM format.');

/**
 * One day's opening hours.
 *
 * `open` and `close` are optional so that a closed day can be recorded as
 * `{ closed: true }` without inventing times for it.
 */
const dayHoursSchema = z.object({
  open: timeOfDaySchema.optional(),
  close: timeOfDaySchema.optional(),
  closed: z.boolean().default(false),
});

export type DayHours = z.infer<typeof dayHoursSchema>;

export const BUSINESS_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type BusinessDay = (typeof BUSINESS_DAYS)[number];

/**
 * The seven day entries, each optional.
 *
 * Every day being optional is deliberate: a business that has only filled in its
 * weekdays should still have those weekdays available to the agent, rather than
 * losing the lot to one missing key.
 */
export const businessHoursSchema = z.object({
  monday: dayHoursSchema.optional(),
  tuesday: dayHoursSchema.optional(),
  wednesday: dayHoursSchema.optional(),
  thursday: dayHoursSchema.optional(),
  friday: dayHoursSchema.optional(),
  saturday: dayHoursSchema.optional(),
  sunday: dayHoursSchema.optional(),
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

/**
 * Narrows a stored `businessHours` value, or returns null.
 *
 * Null covers all three of "the column is null", "the JSON is the wrong shape",
 * and "the object parsed but named no days" — from the caller's point of view they
 * are the same situation: there are no hours to state.
 */
export function parseBusinessHours(value: unknown): BusinessHours | null {
  const parsed = businessHoursSchema.safeParse(value);
  if (!parsed.success) return null;
  const hasAnyDay = BUSINESS_DAYS.some((day) => parsed.data[day] !== undefined);
  return hasAnyDay ? parsed.data : null;
}
