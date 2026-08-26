import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type EmptyStateProps = {
  /** A Lucide icon component, rendered in a subtle rounded badge. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Primary action — usually the "add your first X" button. */
  action?: React.ReactNode;
  /** A secondary link or hint rendered beneath the action. */
  secondaryAction?: React.ReactNode;
  className?: string;
};

/**
 * The brief is explicit that no core screen shows a blank area — an empty list
 * explains what will appear there and offers the first step. This is that
 * treatment, used by every collection view so the voice stays consistent.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" aria-hidden="true" />
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
      {secondaryAction ? <div className="text-sm text-muted-foreground">{secondaryAction}</div> : null}
    </div>
  );
}
