'use client';

/**
 * The two input types an automation's settings need that the shared primitives do not cover,
 * plus the defensive readers every settings field uses.
 *
 * Both inputs hold a draft string of their own rather than deriving the box's contents from the
 * stored value on every keystroke. A controlled number field that re-reads a parsed number
 * cannot be cleared in order to retype, and a comma-separated field that re-joins a parsed array
 * swallows the space after every comma. Each of these keeps the text as typed, reports the
 * parsed value as it goes, and tidies itself up on blur.
 *
 * A step's config is JSON, so any key can be missing or the wrong type. The readers below
 * always return something usable rather than letting `undefined` reach an input.
 */

import { forwardRef, useState } from 'react';

import { Input } from '@/components/ui/input';

type NativeInputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** A stored string with content, or null. */
export function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** A stored finite number, or null. */
export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A stored list of non-empty strings. */
export function listValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

type NumberInputProps = Omit<NativeInputProps, 'value' | 'onChange' | 'type'> & {
  value: number;
  min: number;
  max: number;
  onValueChange: (next: number) => void;
};

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, min, max, onValueChange, ...props }, ref) => {
    const [draft, setDraft] = useState(() => String(value));

    return (
      <Input
        ref={ref}
        {...props}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number.parseInt(event.target.value, 10);
          // Half-typed or out-of-range text stays visible but uncommitted, so the saved value is
          // never NaN and never quietly disagrees with what the box shows.
          if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onValueChange(parsed);
        }}
        onBlur={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          const settled = Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : value;
          setDraft(String(settled));
          onValueChange(settled);
        }}
      />
    );
  },
);
NumberInput.displayName = 'NumberInput';

type CommaListInputProps = Omit<NativeInputProps, 'value' | 'onChange'> & {
  value: readonly string[];
  onValueChange: (next: string[]) => void;
};

export const CommaListInput = forwardRef<HTMLInputElement, CommaListInputProps>(
  ({ value, onValueChange, ...props }, ref) => {
    const [draft, setDraft] = useState(() => value.join(', '));

    return (
      <Input
        ref={ref}
        {...props}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onValueChange(parseCommaList(event.target.value));
        }}
        onBlur={(event) => {
          const settled = parseCommaList(event.target.value);
          setDraft(settled.join(', '));
          onValueChange(settled);
        }}
      />
    );
  },
);
CommaListInput.displayName = 'CommaListInput';
