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
        {/* LAYER 1: LIGHT-GRAY SHADOW / ACCENTS (Base Layer) */}
        <path
          id="accent-crescent"
          fill="#E2E0DF"
          d="M 43.0 119.0 C 40.5 124.0, 39.0 125.7, 38.0 129.0 C 36.3 134.3, 34.7 135.7, 34.0 139.0 C 33.0 144.3, 32.5 145.7, 32.0 149.0 C 31.0 154.3, 29.8 155.7, 29.0 159.0 C 28.3 162.3, 28.0 165.7, 28.0 169.0 C 28.0 174.0, 28.0 175.7, 28.0 179.0 C 28.0 184.0, 28.0 185.7, 28.0 189.0 C 28.0 194.0, 28.5 195.7, 29.0 199.0 C 29.7 204.0, 30.2 205.7, 31.0 209.0 C 32.0 214.0, 32.8 215.7, 34.0 219.0 C 35.5 224.0, 36.0 225.7, 37.0 229.0 C 38.7 234.0, 40.2 235.7, 42.0 239.0 C 44.7 244.0, 46.2 245.7, 48.0 249.0 C 50.8 254.0, 52.8 255.7, 55.0 259.0 C 58.7 264.0, 61.2 265.7, 64.0 269.0 C 69.2 274.0, 72.3 275.7, 76.0 279.0 C 82.5 284.0, 84.7 285.7, 89.0 289.0 C 97.8 295.7, 102.3 296.0, 109.0 299.0 C 122.3 305.0, 131.7 305.3, 143.0 307.0 C 158.3 309.3, 177.3 304.7, 189.0 303.0 C 179.5 292.0, 169.5 282.7, 160.0 280.0 C 150.0 277.2, 137.5 250.0, 130.0 240.0 C 120.0 226.7, 107.5 210.0, 100.0 200.0 C 91.7 188.9, 81.3 170.0, 75.0 160.0 C 68.3 149.3, 59.8 140.7, 55.0 135.0 C 50.3 129.3, 44.8 121.7, 43.0 119.0 Z"
        />
        <path
          id="accent-tail"
          stroke="#E2E0DF"
          strokeWidth="17"
          strokeLinecap="round"
          fill="none"
          d="M 253.5 287.0 L 276.0 308.0"
        />

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
