import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * An inline message about the state of the page or the last action.
 *
 * Each variant is a semantic surface plus its border and a coloured icon; the body text
 * stays at full foreground contrast rather than being tinted, because tinted body copy is
 * harder to read and the surface already carries the meaning.
 *
 * The optional leading icon is positioned absolutely and the following siblings are
 * indented to clear it. That is less elegant than a grid, but it works whether the caller
 * passes an icon or not and whether the body is one line or five.
 */
const alertVariants = cva(
  [
    'relative w-full rounded-lg border px-4 py-3.5 text-sm',
    '[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7',
  ],
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground [&>svg]:text-muted-foreground',
        info: 'border-info-border bg-info-surface text-foreground [&>svg]:text-info',
        success: 'border-success-border bg-success-surface text-foreground [&>svg]:text-success',
        warning: 'border-warning-border bg-warning-surface text-foreground [&>svg]:text-warning',
        destructive:
          'border-destructive-border bg-destructive-surface text-foreground [&>svg]:text-destructive',
        /* For an explanation of something the AI agent did or decided. */
        ai: 'border-ai-border bg-ai-surface text-foreground [&>svg]:text-ai',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type AlertProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & {
    /**
     * Announces the message the moment it appears.
     *
     * Set this only when the alert is the result of something the user just did — a form that
     * failed, an export that did not download, a plan that changed. `assertive` interrupts
     * whatever is being read, which is right for a failure and wrong for a confirmation;
     * `polite` waits for a pause.
     *
     * Left off, the alert is ordinary page content. Most alerts in this product are: a
     * permission notice, a plan approaching its limit, a warning that a trigger is not wired up
     * yet. Those are present when the page loads, and wrapping page furniture in a live region
     * makes a screen reader read the furniture before the page.
     */
    live?: 'assertive' | 'polite';
  };

const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, live, ...props }, ref) => (
    <div
      ref={ref}
      role={live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

/**
 * The message's first line. A `<p>`, not a heading.
 *
 * An alert is a message, not a section of the document, so putting its title in the heading
 * outline files "WhatsApp refused the last request" between "Numbers on this account" and the
 * next real section. The weight is what makes it read as a title; the outline stays clean.
 */
const AlertTitle = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('mb-1 text-sm font-semibold leading-snug tracking-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('max-w-prose text-sm text-muted-foreground [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
