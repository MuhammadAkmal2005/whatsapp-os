import { cn } from '@/lib/utils';

/**
 * A section's opening.
 *
 * Alignment is a prop rather than a default because a page where every section announces
 * itself the same way reads as a template. Most sections here open on the left, against the
 * text column; the two that centre do it because what follows them is symmetrical.
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'start',
  className,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  align?: 'start' | 'center';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      <p className="eyebrow text-primary">{eyebrow}</p>
      <h2 className="mk-display-sm max-w-2xl text-foreground">{title}</h2>
      {lead ? (
        <p
          className={cn(
            'max-w-prose text-md leading-relaxed text-muted-foreground',
            align === 'center' && 'mx-auto',
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}
