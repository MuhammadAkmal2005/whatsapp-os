import { cn } from '@/lib/utils';
import { APP_NAME } from '@/config/constants';

/**
 * The ConvoNexa mark: a rounded speech bubble with two crossing conversation lines
 * inside, representing the convergence of human and AI dialogue. Deliberately not any
 * messaging platform's own glyph or brand colour.
 *
 * `tone` exists because the brand green is tuned to carry white text on a paper ground.
 * At 25% lightness it all but disappears on the ink sidebar, so the chrome gets the
 * lifted sidebar green and inverts the lines to the panel's own colour. The alternative —
 * one fill everywhere — means the mark is either invisible in the sidebar or too pale on
 * an auth card.
 */
export function LogoMark({
  className,
  tone = 'brand',
}: {
  className?: string;
  tone?: 'brand' | 'sidebar';
}) {
  const bubble = tone === 'sidebar' ? 'fill-sidebar-primary' : 'fill-primary';
  const lines = tone === 'sidebar' ? 'stroke-sidebar' : 'stroke-primary-foreground';
  const spark = tone === 'sidebar' ? 'fill-sidebar' : 'fill-primary-foreground';

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={`${APP_NAME} logo`}
      className={cn('size-7', className)}
    >
      <rect x="3" y="4" width="26" height="20" rx="6" className={bubble} />
      <path d="M8 24v5l5-5H8Z" className={bubble} />
      {/* Two converging lines — the AI and human nexus. */}
      <path
        d="M10 11.5h12M10 15.5h9"
        strokeWidth="2"
        strokeLinecap="round"
        className={lines}
      />
      <circle cx="22" cy="15.5" r="1.5" className={spark} />
    </svg>
  );
}

type LogoProps = {
  className?: string;
  markClassName?: string;
  /** Hide the wordmark, e.g. on a collapsed sidebar. */
  hideWordmark?: boolean;
  wordmarkClassName?: string;
  tone?: 'brand' | 'sidebar';
};

export function Logo({
  className,
  markClassName,
  hideWordmark,
  wordmarkClassName,
  tone,
}: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={markClassName} tone={tone} />
      {hideWordmark ? null : (
        <span className={cn('text-md font-semibold tracking-tight', wordmarkClassName)}>
          {APP_NAME}
        </span>
      )}
    </span>
  );
}
