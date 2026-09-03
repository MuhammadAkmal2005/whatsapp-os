'use client';

import { Plus } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * The FAQ.
 *
 * A button-and-region pattern rather than `<details>`, because a native disclosure cannot be
 * animated open — it snaps, which on a list of six looks like the page is flinching.
 *
 * The height animation is a one-row grid moving between `0fr` and `1fr`. That is what avoids
 * the two usual failure modes: a measured pixel height clips the answer when the window is
 * later narrowed and the text reflows taller, and a guessed `max-height` clips it the day
 * someone writes a longer answer. Where the browser does not support animating grid tracks the
 * disclosure still opens and closes, just instantly.
 */

export interface FaqItem {
  question: string;
  answer: string;
}

export function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const toggle = (index: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item, index) => {
        const isOpen = open.has(index);
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-button-${index}`;

        return (
          <div key={item.question}>
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(index)}
                className="group flex w-full items-start justify-between gap-6 py-4 text-left transition-colors duration-fast ease-out hover:text-primary"
              >
                <span className="text-base font-medium text-foreground group-hover:text-primary">
                  {item.question}
                </span>
                {/* A plus that becomes a cross: a rotation, so the two states are the same
                    glyph moving rather than one icon replacing another. */}
                <Plus
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-moderate ease-out group-hover:text-primary',
                    isOpen && 'rotate-45',
                  )}
                />
              </button>
            </h3>

            <div
              className="grid transition-[grid-template-rows] duration-moderate ease-out"
              style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            >
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                aria-hidden={!isOpen}
                className="overflow-hidden"
              >
                <p className="max-w-prose pb-5 pr-8 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
