import { cn } from '@/lib/utils';

/**
 * The page header.
 *
 * Every workspace screen opens the same way, so the eye learns one place to look for
 * "where am I" and one place to look for "what can I do here". Previously each page
 * hand-rolled this block, which is why the heading size, the gap and the action alignment
 * drifted between them.
 *
 * The description is capped at a readable measure. A one-line summary that runs the full
 * width of a 27-inch monitor is technically legible and practically unread.
 */
export type PageHeaderProps = {
  title: string;
  description?: React.ReactNode;
  /** A small uppercase label above the title — the section this page belongs to. */
  eyebrow?: string;
  /**
   * Status chips shown beside the title, wrapping under it when there is no room.
   *
   * They sit outside the `h1` on purpose: a heading is the page's name, and a screen
   * reader announcing "Ayesha Malik VIP Qualified Opted out" as one heading is worse than
   * announcing the name and then reading the chips as the separate facts they are.
   */
  badges?: React.ReactNode;
  /**
   * An identifying mark before the title — a customer's avatar, for instance. Only for
   * something that identifies *this* record; a generic icon repeated on every page of a
   * type is decoration, and the title already said what kind of thing this is.
   */
  leading?: React.ReactNode;
  /** Primary and secondary actions for the whole page. */
  actions?: React.ReactNode;
  /** Breadcrumbs or a back link, rendered above the eyebrow. */
  breadcrumb?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  badges,
  leading,
  actions,
  breadcrumb,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4', className)}>
      {breadcrumb}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {/* `items-start`, not `items-center`: the mark aligns with the first line of the
            title so a wrapped two-line title does not push it out of place. */}
        <div className="flex min-w-0 items-start gap-3.5">
          {leading}
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
              {badges}
            </div>
            {description ? (
              <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          // shrink-0 keeps a two-word button from wrapping mid-label when the title is long.
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
