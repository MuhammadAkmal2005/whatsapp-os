import { cn } from '@/lib/utils';
import { APP_NAME } from '@/config/constants';

/**
 * The ConvoNexa mark: a rounded speech bubble with two crossing conversation
 * lines inside, representing the convergence of human and AI dialogue.
 * Drawn in `currentColor` so it inherits the surrounding text colour — it sits
 * on a dark sidebar and a light auth card without a second asset. Deliberately
 * not any messaging platform's own glyph or brand colour.
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
      {/* Rounded chat bubble shape */}
      <rect x="3" y="4" width="26" height="20" rx="6" className="fill-primary" />
      {/* Tail */}
      <path d="M8 24v5l5-5H8Z" className="fill-primary" />
      {/* Two converging lines — representing AI + human nexus */}
      <path
        d="M10 11.5h12M10 15.5h9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      {/* AI spark dot */}
      <circle cx="22" cy="15.5" r="1.5" className="fill-primary-foreground" />
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
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      {hideWordmark ? null : (
        <span className={cn('text-base font-semibold tracking-tight', wordmarkClassName)}>
          {APP_NAME}
        </span>
      )}
    </span>
  );
}
