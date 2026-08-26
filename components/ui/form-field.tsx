'use client';

import { Slot } from '@radix-ui/react-slot';
import { createContext, forwardRef, useContext, useId } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * A small, framework-agnostic field primitive. It exists because accessible form
 * errors need three ids to agree — the control's `id`, the `aria-describedby`
 * pointing at the message, and the `aria-invalid` flag that drives the red
 * styling — and getting that right by hand at every call site is where it slips.
 *
 * It is deliberately not tied to react-hook-form: this app submits through
 * server actions, and the error text arrives from the server's Zod result. A
 * field simply takes an optional `error` string and wires everything from it.
 */

type FieldContextValue = {
  fieldId: string;
  descriptionId: string;
  messageId: string;
  hasError: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

function useField(): FieldContextValue {
  const ctx = useContext(FieldContext);
  if (!ctx) {
    throw new Error('FormField subcomponents must be used within <FormField>.');
  }
  return ctx;
}

type FormFieldProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Server-side validation message for this field, if any. */
  error?: string | null;
};

const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  ({ className, error, children, ...props }, ref) => {
    const id = useId();
    const value: FieldContextValue = {
      fieldId: `${id}-field`,
      descriptionId: `${id}-description`,
      messageId: `${id}-message`,
      hasError: Boolean(error),
    };
    return (
      <FieldContext.Provider value={value}>
        <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props}>
          {children}
          {error ? (
            <p id={value.messageId} className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </FieldContext.Provider>
    );
  },
);
FormField.displayName = 'FormField';

const FormLabel = forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => {
  const { fieldId, hasError } = useField();
  return (
    <Label
      ref={ref}
      htmlFor={fieldId}
      className={cn(hasError && 'text-destructive', className)}
      {...props}
    />
  );
});
FormLabel.displayName = 'FormLabel';

/**
 * Wraps the actual control (Input, Textarea, Select trigger, …) and injects the
 * id and aria wiring onto it via a Slot, so the control itself needs no props.
 */
const FormControl = forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { fieldId, descriptionId, messageId, hasError } = useField();
  return (
    <Slot
      ref={ref}
      id={fieldId}
      aria-invalid={hasError || undefined}
      aria-describedby={hasError ? `${descriptionId} ${messageId}` : descriptionId}
      {...props}
    />
  );
});
FormControl.displayName = 'FormControl';

function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useField();
  return (
    <p id={descriptionId} className={cn('text-sm text-muted-foreground', className)} {...props} />
  );
}

export { FormField, FormLabel, FormControl, FormDescription };
