import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

type SpinnerProps = {
  className?: string;
  /** Accessible label announced to screen readers. Defaults to "Loading". */
  label?: string;
};

/**
 * A single spinner treatment used everywhere something is in flight, so a
 * pending state always looks the same. The label is announced; the icon is
 * hidden from assistive tech since it carries no information on its own.
 */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn('size-4 animate-spin text-muted-foreground', className)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
