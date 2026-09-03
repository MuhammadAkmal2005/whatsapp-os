'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The "what actually happens" section: a list of steps on the left, one pinned visual on the
 * right that changes as each step reaches the middle of the screen.
 *
 * This is the one place on the page where scroll position drives more than a fade, and it earns
 * it — the argument being made is a sequence, and a sequence is the one thing a stack of
 * feature cards genuinely cannot express.
 *
 * The pinned column is a single-cell grid with every visual in the same cell, so the box takes
 * the height of the tallest one and the crossfade needs no measured height and no fixed
 * aspect ratio. Below `lg` the pin is dropped entirely and each visual sits under its own step,
 * which is a different composition rather than the desktop one squeezed narrow.
 */

export interface WorkflowStep {
  id: string;
  kind: string;
  title: string;
  body: string;
  visual: ReactNode;
}

export function Workflow({ steps }: { steps: readonly WorkflowStep[] }) {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const elements = stepRefs.current.filter((element): element is HTMLLIElement =>
      Boolean(element),
    );
    if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return;

    // A narrow band across the middle of the viewport: whichever step is crossing it is the
    // active one. Watching for "mostly visible" instead would leave two steps competing on a
    // tall screen and make the visual flicker between them.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = elements.indexOf(entry.target as HTMLLIElement);
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: '-48% 0px -48% 0px', threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [steps.length]);

  return (
    <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16">
      <ol className="flex min-w-0 flex-col">
        {steps.map((step, index) => {
          const isActive = index === active;

          return (
            <li
              key={step.id}
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
              className="min-w-0 border-t border-border py-7 first:border-t-0 first:pt-0 lg:py-12"
            >
              <div
                className={cn(
                  'flex flex-col gap-2 border-l-2 pl-5 transition-colors duration-moderate ease-out',
                  isActive ? 'border-primary' : 'border-transparent',
                )}
              >
                <span
                  className={cn(
                    'text-2xs font-semibold uppercase tracking-wide transition-colors duration-moderate ease-out',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {step.kind}
                </span>
                <h3 className="mk-display-sm text-foreground">{step.title}</h3>
                <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>

              {/* The phone layout: the visual belongs to its step, so it sits with it. */}
              <div className="mt-5 min-w-0 pl-5 lg:hidden">{step.visual}</div>
            </li>
          );
        })}
      </ol>

      <div className="hidden lg:grid lg:sticky lg:top-24 lg:self-start">
        {steps.map((step, index) => (
          <div
            key={step.id}
            aria-hidden={index !== active}
            className={cn(
              'col-start-1 row-start-1 transition-opacity duration-slow ease-out',
              index === active ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {step.visual}
          </div>
        ))}
      </div>
    </div>
  );
}
