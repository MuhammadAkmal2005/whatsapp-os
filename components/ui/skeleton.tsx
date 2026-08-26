import { cn } from '@/lib/utils';

/**
 * A loading placeholder. Shown in the same shape and position as the content it
 * stands in for, so the layout does not jump when data arrives.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
