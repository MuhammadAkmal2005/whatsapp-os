import { cn } from '@/lib/utils';

/**
 * The lighting for a marketing band.
 *
 * Four layers, none of them a full-bleed gradient wash: a masked rule grid for a sense of
 * precision, one broad light source above the fold and a narrower cool one low and left so
 * the field is not lit evenly, and grain over the top to stop large flat areas banding on
 * an eight-bit panel.
 *
 * Every layer reads a `--mk-*` token, so the same markup lights an ink band from within and
 * tints a paper band from above — the model inverts with the theme without a second
 * component or a `dark:` variant anywhere in here.
 *
 * Absolutely positioned, `pointer-events-none` and `aria-hidden`, so it never enters the
 * layout, the tab order or the accessibility tree. `inset-0` inside an `overflow-hidden`
 * parent is also what guarantees it cannot contribute a scrollbar.
 */
export function Atmosphere({
  className,
  intensity = 'full',
}: {
  className?: string;
  /** `quiet` drops the grid and the second light — for bands that sit between lit sections. */
  intensity?: 'full' | 'quiet';
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden animate-mk-atmosphere',
        className,
      )}
    >
      {intensity === 'full' ? <div className="absolute inset-0 mk-grid" /> : null}

      {/* Sized in vw/vh with a max, so the light scales with the viewport instead of becoming
          a small bright spot on a wide monitor — and is clipped by the parent regardless. */}
      <div className="mk-glow absolute left-1/2 top-0 h-[38rem] w-[min(120vw,68rem)] -translate-x-1/2 -translate-y-1/3" />

      {intensity === 'full' ? (
        <div className="mk-glow-soft absolute -left-1/4 bottom-0 h-[26rem] w-[min(90vw,44rem)] translate-y-1/3" />
      ) : null}

      <div className="mk-noise absolute inset-0" />
    </div>
  );
}
