import { cn } from '@/lib/utils';

/**
 * A quota gauge: how much of an allowance has been consumed.
 *
 * One component for both the billing screen and the analytics usage panel, which
 * previously drew the same bar two different ways — and disagreed about the colour at
 * which "nearly full" starts.
 *
 * The tone is derived from the ratio here rather than being passed in, so "amber at 80%,
 * red when exceeded" is decided in exactly one place. Colour is never the only signal: the
 * caller always renders a text value beside the bar, and the bar itself carries an
 * accessible label and value for assistive technology.
 */

type MeterTone = 'neutral' | 'warning' | 'danger';

function toneFor(ratio: number, exceeded: boolean): MeterTone {
  if (exceeded) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'neutral';
}

const TONE_FILL: Record<MeterTone, string> = {
  neutral: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

export type MeterProps = {
  /** Amount consumed. */
  value: number;
  /** The allowance. `null` means unlimited, which renders an inert track. */
  max: number | null;
  /** Describes what is being measured, for screen readers. */
  label: string;
  /** Forces the exceeded tone even when the ratio rounds below 1 — the server decides. */
  exceeded?: boolean;
  className?: string;
};

export function Meter({ value, max, label, exceeded = false, className }: MeterProps) {
  const isUnlimited = max === null;
  const ratio = isUnlimited || max === 0 ? 0 : value / max;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  const tone = toneFor(ratio, exceeded);

  if (isUnlimited) {
    return (
      <div
        className={cn('h-1.5 w-full rounded-full bg-muted', className)}
        role="img"
        aria-label={`${label}: unlimited`}
      />
    );
  }

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value.toLocaleString()} of ${max.toLocaleString()}`}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-slow ease-out',
          TONE_FILL[tone],
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
