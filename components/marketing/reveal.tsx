'use client';

import { createElement, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Scroll-triggered reveal.
 *
 * The hidden and settled states are declared in `globals.css` as `.mk-reveal` variants; all
 * this component does is add `data-shown="true"` once its element has entered the viewport.
 * That split is deliberate — the browser animates opacity and transform on the compositor,
 * and the per-element JavaScript cost is a single attribute write that never repeats.
 *
 * One observer serves the whole page. Twenty-odd revealed blocks with twenty-odd observers
 * would each carry their own intersection bookkeeping for no benefit, since they all want
 * the same trigger point.
 */

type RevealVariant = 'up' | 'left' | 'right' | 'blur' | 'settle';

type RevealTag = 'div' | 'section' | 'article' | 'header' | 'figure' | 'ul' | 'ol' | 'li' | 'dl';

interface RevealProps {
  children: ReactNode;
  /** Direction or treatment. `blur` is expensive — reserve it for a single focal element. */
  variant?: RevealVariant;
  /** Milliseconds of transition delay, used to stagger siblings. */
  delay?: number;
  className?: string;
  as?: RevealTag;
}

let sharedObserver: IntersectionObserver | null = null;
const pending = new WeakMap<Element, () => void>();

function getSharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const reveal = pending.get(entry.target);
          if (!reveal) continue;

          reveal();
          pending.delete(entry.target);
          sharedObserver?.unobserve(entry.target);
        }
      },
      // A negative bottom margin holds the trigger until the block is properly on screen
      // rather than one pixel past the fold, which is what makes the motion feel like a
      // response to scrolling instead of a race with it.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );
  }

  return sharedObserver;
}

export function Reveal({ children, variant = 'up', delay = 0, className, as = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || shown) return;

    const observer = getSharedObserver();

    // No observer support means no reveal: show the content and move on. A visual
    // enhancement is never worth an empty page.
    if (!observer) {
      setShown(true);
      return;
    }

    pending.set(element, () => setShown(true));
    observer.observe(element);

    return () => {
      pending.delete(element);
      observer.unobserve(element);
    };
  }, [shown]);

  return createElement(
    as,
    {
      ref,
      className: cn('mk-reveal', className),
      'data-variant': variant,
      'data-shown': shown ? 'true' : undefined,
      style: delay ? { transitionDelay: `${delay}ms` } : undefined,
    },
    children,
  );
}
