import { cn } from '@/lib/utils';

/**
 * A placeholder for content that has not arrived.
 *
 * Skeletons in this product mimic the geometry of the real thing — a row is a row's
 * height, an avatar is the avatar's diameter — because the point is to hold the layout
 * still. A placeholder that is the wrong size makes the page jump when data lands, which
 * is worse than a spinner.
 *
 * The sweep sits inside an overflow-hidden box and travels left to right. It is drawn
 * with `border-strong` at half opacity, which lands darker than `muted` in light mode and
 * lighter in dark mode — in both cases a visible lift against the base, with no raw
 * palette colour that would be right in only one theme.
 *
 * Marked `aria-hidden`: an assistive technology should hear "loading" once from the
 * container, not hear a dozen empty boxes. Wrap a group in an element with
 * `role="status"` and an accessible label.
 *
 * There is deliberately no `SkeletonRow` or `SkeletonText` helper. Every route skeleton in
 * the product copies the geometry of one specific screen, and a generic row shaped like an
 * average of all of them is the thing that makes the layout jump.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('relative isolate overflow-hidden rounded-md bg-muted', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-border-strong/50 to-transparent" />
    </div>
  );
}

export { Skeleton };
