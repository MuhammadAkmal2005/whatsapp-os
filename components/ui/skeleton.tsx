import { cn } from '@/lib/utils';

/**
 * A loading placeholder with a subtle shimmer effect. Shown in the same shape
 * and position as the content it stands in for, so the layout does not jump
 * when data arrives.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        className,
      )}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-muted-foreground/5 to-transparent" />
    </div>
  );
}

export { Skeleton };
