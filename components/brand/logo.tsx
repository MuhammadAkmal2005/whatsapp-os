import { cn } from '@/lib/utils';
import { APP_NAME } from '@/config/constants';

/**
 * The finalized ConvoNexa brand mark: a speech bubble with inner monogram 'C',
 * featuring brand green (#29AE69), white outer border, subtle light-gray shadow accent,
 * and dark green inner C shadow.
 *
 * `tone` is preserved for backward-compatibility with existing component callers.
 */
export function LogoMark({
  className,
  tone: _tone = 'brand',
}: {
  className?: string;
  tone?: 'brand' | 'sidebar';
}) {
  return (
    <svg
      viewBox="0 0 337 330"
      fill="none"
      role="img"
      aria-label={`${APP_NAME} logo`}
      className={cn('size-7 shrink-0', className)}
    >
      <g id="convoNexa-logo">


        {/* LAYER 2: WHITE OUTER BORDER (Surrounding Green Shape) */}
        <path
          id="speech-bubble-outline"
          fill="#FFFFFF"
          stroke="#FFFFFF"
          strokeWidth="20"
          strokeLinejoin="round"
          strokeLinecap="round"
          d="
            M 304.5 162.0
            L 304.5 292.0
            A 7.5 7.5 0 0 1 291.7 297.7
            L 256.5 262.5
            A 128 128 0 1 1 304.5 162.0
            Z
          "
        />

        {/* LAYER 3: GREEN PRIMARY LOGO SHAPE */}
        <path
          id="speech-bubble"
          fill="#29AE69"
          d="
            M 304.5 162.0
            L 304.5 292.0
            A 7.5 7.5 0 0 1 291.7 297.7
            L 256.5 262.5
            A 128 128 0 1 1 304.5 162.0
            Z
          "
        />

        {/* LAYER 4: DARK GREEN INNER C SHADOW */}
        <path
          id="inner-shadow"
          fill="none"
          stroke="#105036"
          strokeWidth="27"
          strokeLinecap="round"
          d="M 234.5 217.5 A 76 76 0 1 1 234.5 125.5"
        />

        {/* LAYER 5: WHITE INNER C */}
        <path
          id="letter-c"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="27"
          strokeLinecap="round"
          d="M 237.0 208.0 A 76 76 0 1 1 237.0 116.0"
        />
      </g>
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
