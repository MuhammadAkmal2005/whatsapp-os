import type { ReactNode } from 'react';

import { APP_NAME } from '@/config/constants';
import { cn } from '@/lib/utils';

/**
 * The window chrome the product mockups sit inside.
 *
 * An application window rather than a browser window, deliberately: a URL bar would put a
 * domain on screen that we would then be claiming, and the frame's job is to say "this is
 * the product", which a title bar does just as well.
 *
 * `role="img"` with a label is what keeps these honest for a screen reader. A mockup is an
 * illustration of the product, not content to be read out row by row, so it is announced
 * once as a single image and its interior — sample names, sample prices — is not exposed as
 * though a real conversation were on the page.
 */
interface AppFrameProps {
  children: ReactNode;
  /** Shown in the title bar, and the start of the frame's accessible name. */
  screen: string;
  /** Completes the accessible name: what this particular mockup depicts. */
  label: string;
  className?: string;
}

export function AppFrame({ children, screen, label, className }: AppFrameProps) {
  return (
    <div
      role="img"
      aria-label={`${label}. Illustration of the ${APP_NAME} ${screen.toLowerCase()} screen.`}
      className={cn(
        'w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-overlay',
        className,
      )}
    >
      <div className="flex h-9 items-center gap-3 border-b border-border bg-surface-sunken px-3">
        <div className="flex shrink-0 gap-1.5">
          <span className="size-2 rounded-full bg-border-strong" />
          <span className="size-2 rounded-full bg-border-strong" />
          <span className="size-2 rounded-full bg-border-strong" />
        </div>
        <p className="truncate text-2xs font-medium text-muted-foreground">
          {APP_NAME} <span className="text-border-strong">·</span> {screen}
        </p>
        {/* Balances the traffic lights so the label sits optically centred without a
            three-column grid for two decorative clusters. */}
        <div className="ml-auto hidden shrink-0 items-center gap-1.5 sm:flex">
          <span className="h-1.5 w-6 rounded-full bg-border" />
          <span className="size-4 rounded-full border border-border bg-muted" />
        </div>
      </div>
      {children}
    </div>
  );
}
