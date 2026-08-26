import { cn } from '@/lib/utils';
import { APP_NAME } from '@/config/constants';

/**
 * The product mark: a rounded chat bubble (the channel) with an upward spark
 * inside it (the AI doing the work). Drawn in `currentColor` so it inherits the
 * surrounding text colour — it sits on a dark sidebar and a light auth card
 * without a second asset. Deliberately not WhatsApp's own glyph or brand green;
 * the brief is explicit that the product must not impersonate the channel.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={`${APP_NAME} logo`}
      className={cn('size-7', className)}
    >
      <path
        d="M6 4h20a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H12l-6 5v-5H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        className="fill-primary"
      />
      <path
        d="M16 8.5l2.4 4.9 5.1.7-3.7 3.5.9 5-4.7-2.5-4.7 2.5.9-5-3.7-3.5 5.1-.7L16 8.5Z"
        className="fill-primary-foreground"
      />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  markClassName?: string;
  /** Hide the wordmark, e.g. on a collapsed sidebar. */
  hideWordmark?: boolean;
  wordmarkClassName?: string;
};

export function Logo({ className, markClassName, hideWordmark, wordmarkClassName }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={markClassName} />
      {hideWordmark ? null : (
        <span className={cn('text-base font-semibold tracking-tight', wordmarkClassName)}>
          {APP_NAME}
        </span>
      )}
    </span>
  );
}
