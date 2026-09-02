import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type EmptyStateProps = {
  /** A Lucide icon component, rendered in a squared tile above the title. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Primary action — usually the "add your first X" button. */
  action?: React.ReactNode;
  /** A secondary link or hint rendered beneath the action. */
  secondaryAction?: React.ReactNode;
  /**
   * `compact` for an empty state nested inside a card or a pane, where the full-height
   * treatment would push the surrounding chrome off screen.
   */
  size?: 'default' | 'compact';
  /**
   * `plain` drops the well and the hairline, for use inside a container that already
   * has its own border — otherwise the two frames sit one inside the other.
   */
  variant?: 'default' | 'plain';
  className?: string;
};

/**
 * The empty state.
 *
 * No screen in this product shows a blank area: an empty list says what will appear
 * there and offers the first step. Every collection view routes through this component so
 * the voice stays consistent.
 *
 * The frame is a sunken well with a solid hairline rather than a dashed border. Dashed
 * borders read as an unfinished drop zone, which is the wrong signal for a screen that is
 * working correctly and simply has nothing in it yet.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'default',
  variant = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex animate-fade-in flex-col items-center justify-center gap-4 px-6 text-center',
        variant === 'default' && 'rounded-lg border border-border bg-surface-sunken',
        size === 'default' ? 'py-16 sm:py-20' : 'py-10',
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-11 items-center justify-center rounded-md border border-primary-border bg-primary-surface text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      {secondaryAction ? (
        <div className="text-sm text-muted-foreground">{secondaryAction}</div>
      ) : null}
    </div>
  );
}
