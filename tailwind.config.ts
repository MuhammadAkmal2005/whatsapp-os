import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * ConvoNexa theme.
 *
 * Every value here is a reference to a CSS custom property declared in
 * app/globals.css. Nothing is defined twice, and no utility class knows which theme
 * is active — that is what lets a single `dark` class on <html> repaint the product.
 *
 * The scales are deliberately narrow. A dense operational interface is easier to keep
 * coherent with eight type sizes and four radii than with twenty of each, and a
 * missing option is a prompt to reuse an existing one rather than to invent a
 * one-off.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.25rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '80rem' },
    },
    extend: {
      colors: {
        border: {
          DEFAULT: 'hsl(var(--border))',
          strong: 'hsl(var(--border-strong))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        /* The extra surface steps that let depth be expressed without shadow: a band
           that holds content below the page, a well that sits below a card, the step
           *above* a card, and the tint a selected row takes. On ink `elevated` is
           genuinely lighter than the card; on paper the card is already white, so it
           holds there and depth falls to the border. Both are the same token, which is
           why a panel-inside-a-card needs no `dark:`.

           `panel` and `sunken` were one token until the light theme made the conflict
           visible: a well drawn on a white card has to be *lighter* than the page, and
           a band drawn under the page has to be darker. One value could satisfy either
           reading but not both, so the regions that are grounds — a message thread, a
           marketing section — took the new name. */
        surface: {
          panel: 'hsl(var(--surface-panel))',
          sunken: 'hsl(var(--surface-sunken))',
          elevated: 'hsl(var(--surface-elevated))',
          selected: 'hsl(var(--surface-selected))',
        },

        /* Pointer and press feedback, as one vocabulary. Before this the product had
           three answers to "what does a row look like under the pointer" — `bg-accent`
           on buttons, `bg-muted` on some rows, `bg-surface-sunken` on others — which is
           three chances for a hover to look like a selection. `hover` is deliberately
           the same value as `accent`, so naming the state changed no pixels. */
        interactive: {
          hover: 'hsl(var(--interactive-hover))',
          pressed: 'hsl(var(--interactive-pressed))',
        },

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: 'hsl(var(--primary-hover))',
          surface: 'hsl(var(--primary-surface))',
          border: 'hsl(var(--primary-border))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
          border: 'hsl(var(--muted-border))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },

        /* Status families. Each carries a solid fill for emphasis, a readable
           foreground, and a surface/border pair for banners and chips — so a tinted
           status block never has to reach for a raw palette hue that would be wrong
           in the other theme. */
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          hover: 'hsl(var(--destructive-hover))',
          surface: 'hsl(var(--destructive-surface))',
          border: 'hsl(var(--destructive-border))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          surface: 'hsl(var(--success-surface))',
          border: 'hsl(var(--success-border))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          surface: 'hsl(var(--warning-surface))',
          border: 'hsl(var(--warning-border))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          surface: 'hsl(var(--info-surface))',
          border: 'hsl(var(--info-border))',
        },
        /* Kept distinct from success so "the assistant handled this" never reads as
           "this went well", and from destructive so it never reads as a failure. */
        ai: {
          DEFAULT: 'hsl(var(--ai))',
          foreground: 'hsl(var(--ai-foreground))',
          surface: 'hsl(var(--ai-surface))',
          border: 'hsl(var(--ai-border))',
        },

        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        /* The scrim behind a dialog. The token carries its own alpha so the two themes
           can dim by different amounts — an ink page needs a heavier scrim than a paper
           one to read as "the page behind is out of reach". */
        overlay: 'hsl(var(--overlay))',
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted: 'hsl(var(--sidebar-muted))',
          accent: 'hsl(var(--sidebar-accent))',
          selected: 'hsl(var(--sidebar-selected))',
          border: 'hsl(var(--sidebar-border))',
          /* Display type on the panel — one step further from the panel's ground than
             the body foreground, in whichever direction that is. */
          strong: 'hsl(var(--sidebar-strong))',
          /* The panel keeps its own accent rather than borrowing --primary: it sits on
             its own ground in both themes (tinted paper in light, ink in dark), and a
             green tuned for contrast against the page is not the same green that clears
             4.5:1 against this panel. */
          primary: 'hsl(var(--sidebar-primary))',
        },

        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },

      /* Radius by role. The legacy sm/md/lg names are mapped onto the new roles so
         existing markup lands in the right place: a control that says rounded-md gets
         the control radius, a card that says rounded-lg gets the surface radius. */
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'calc(var(--radius-control) - 2px)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-surface)',
        xl: 'var(--radius-overlay)',
        '2xl': 'calc(var(--radius-overlay) + 5px)',
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      /* Eight steps with paired line-height and tracking. Tight tracking on the large
         sizes and slightly loose on the small ones is what stops a grotesque from
         looking cramped in a heading and mushy in a caption. */
      fontSize: {
        '3xs': ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.01em' }],
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.005em' }],
        xs: ['0.75rem', { lineHeight: '1.0625rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.005em' }],
        xl: ['1.3125rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.015em' }],
        '3xl': ['2rem', { lineHeight: '2.375rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.5rem', { lineHeight: '2.875rem', letterSpacing: '-0.025em' }],
        '5xl': ['3.25rem', { lineHeight: '3.5rem', letterSpacing: '-0.03em' }],
      },

      /* Control heights as named spacing, so h-control, w-control and size-control all
         resolve and a form and a table cannot quietly disagree about how tall a button
         is. */
      spacing: {
        control: '2.125rem',
        'control-sm': '1.75rem',
        'control-lg': '2.5rem',
      },
      maxWidth: {
        prose: 'var(--width-prose)',
        form: 'var(--width-form)',
        page: 'var(--width-page)',
      },

      /* Three levels, for layers that genuinely float. A card is not one of them. */
      boxShadow: {
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        sticky: 'var(--shadow-sticky)',
        none: 'none',
      },

      transitionDuration: {
        instant: 'var(--motion-instant)',
        fast: 'var(--motion-fast)',
        moderate: 'var(--motion-moderate)',
        slow: 'var(--motion-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        emphasis: 'var(--ease-emphasis)',
      },

      /* Three, deliberately. Overlays animate with `tailwindcss-animate`'s own
         `data-[state]` utilities, so a second set of scale and slide keyframes would be
         two vocabularies for one job. What is left is what the product actually uses:
         a fade for an empty state, a short drop for a message that has just arrived,
         and the skeleton sweep. */
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* Sweeps a highlight across a skeleton. Paired with an `animation` entry
           below — without one, Tailwind never emits the keyframes and the shimmer
           silently does nothing. */
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },

        /* ── Marketing motion ──────────────────────────────────────────────────────
           Five, and each earns its place. The public page needs an entrance the product
           does not, because a landing page is read once from the top while the inbox is
           lived in; what it must not have is a different animation per element.

           `mk-enter` is the only entrance keyframe. The staggered hero sequence is the
           same animation at seven different `animation-delay` values, which is why it can
           be pure CSS with no client component behind it. */
        'mk-enter': {
          from: { opacity: '0', transform: 'translateY(0.875rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* The atmosphere fades in on its own, slower curve. Lighting that arrives with the
           headline reads as a flash; lighting that arrives behind it reads as a room. */
        'mk-atmosphere': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        /* Ambient drift for the hero's satellite cards. Two variants at different periods
           and amplitudes so a pair of them never moves in lockstep — the giveaway that a
           float is decoration rather than life. Translation only, a few pixels, no rotation. */
        'mk-float': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(-4px, -14px)' },
        },
        'mk-float-slow': {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '50%': { transform: 'translate(4px, 12px)' },
        },
        /* The live indicator beside "AI replying" — an expanding ring rather than a
           blinking dot, so it reads as activity instead of an alert. */
        'mk-ring': {
          '0%': { opacity: '0.5', transform: 'scale(0.9)' },
          '70%, 100%': { opacity: '0', transform: 'scale(2.1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--motion-moderate) var(--ease-out)',
        'slide-down': 'slide-down var(--motion-fast) var(--ease-out)',
        shimmer: 'shimmer 1.6s var(--ease-in-out) infinite',

        /* `both` fill mode is what makes the delayed steps hold their opening frame instead
           of flashing in and then animating. It is also why globals.css has to zero
           `animation-delay` under reduced motion. */
        'mk-enter': 'mk-enter 620ms var(--ease-out) both',
        'mk-atmosphere': 'mk-atmosphere 1100ms var(--ease-in-out) both',
        'mk-float': 'mk-float 4.6s var(--ease-in-out) infinite',
        'mk-float-slow': 'mk-float-slow 5.4s var(--ease-in-out) infinite',
        'mk-ring': 'mk-ring 2.6s var(--ease-out) infinite',
      },
    },
  },
  plugins: [animate],
};

export default config;
