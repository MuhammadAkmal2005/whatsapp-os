import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';

import { isNavDestinationAvailable } from '@/components/app-shell/nav-config';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ONBOARDING_STEPS, ONBOARDING_STEP_META, type OnboardingStep } from '@/config/constants';
import { cn } from '@/lib/utils';

type OnboardingChecklistProps = {
  completedSteps: readonly string[];
  className?: string;
};

/**
 * The setup checklist, driven entirely by the workspace's real `onboardingCompletedSteps`.
 *
 * Emphasis goes to the first incomplete step *whose screen exists today*, not simply to the
 * first incomplete step. Those are often different: several steps point at screens still being
 * built, and this card used to put its only call to action on whichever step came next in the
 * list — so the one card whose whole job is telling a new owner what to do next regularly
 * offered nothing to do.
 *
 * Which screens exist is asked of the navigation registries, the same source the sidebar reads,
 * so the checklist can no longer drift out of step with the product the way its own
 * hand-maintained list of live paths had.
 *
 * Server-rendered: it reads data and holds no state.
 */
export function OnboardingChecklist({ completedSteps, className }: OnboardingChecklistProps) {
  const done = new Set(completedSteps);
  const total = ONBOARDING_STEPS.length;
  const completedCount = ONBOARDING_STEPS.filter((step) => done.has(step)).length;
  const percent = Math.round((completedCount / total) * 100);

  const focusStep =
    ONBOARDING_STEPS.find(
      (step) => !done.has(step) && isNavDestinationAvailable(ONBOARDING_STEP_META[step].href),
    ) ?? null;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base">Finish setting up</CardTitle>
          <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
            {completedCount} of {total}
          </span>
        </div>
        <CardDescription>A few steps to get your AI answering customers.</CardDescription>

        {/* Deliberately not the `Meter` primitive. `Meter` gauges an allowance being used up and
            turns amber past 80%, so "6 of 7 steps done" would render as a warning — the opposite
            of what it means here. The transition is bound to `width` rather than `all`, which
            would also animate the fill colour on a theme change. */}
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuetext={`${completedCount} of ${total} steps done`}
          aria-label="Setup progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-slow ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </CardHeader>

      <CardContent>
        <ol className="flex flex-col gap-0.5">
          {ONBOARDING_STEPS.map((step) => (
            <ChecklistRow
              key={step}
              step={step}
              isDone={done.has(step)}
              isFocus={step === focusStep}
            />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ChecklistRow({
  step,
  isDone,
  isFocus,
}: {
  step: OnboardingStep;
  isDone: boolean;
  isFocus: boolean;
}) {
  const meta = ONBOARDING_STEP_META[step];
  const isAvailable = isNavDestinationAvailable(meta.href);

  // "Being built" is already on screen as a chip, so repeating it here would make a screen
  // reader say it twice.
  const spokenStatus = isDone ? 'Completed' : isFocus ? 'Next step' : isAvailable ? 'Not started' : null;

  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-md px-3 py-2',
        // The same rail the sidebar puts on the current page, so "you are here" reads the same
        // way everywhere in the product.
        isFocus && 'marker-rail bg-surface-selected',
      )}
    >
      <StepMarker isDone={isDone} isFocus={isFocus} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <StepTitle
            title={meta.title}
            href={meta.href}
            /* A step further down the list that is already built stays reachable — as a link on
               its own title rather than a second button, which would compete with the one call
               to action in a card this narrow. */
            asLink={!isDone && isAvailable && !isFocus}
            isDone={isDone}
            isFocus={isFocus}
          />

          {spokenStatus ? <span className="sr-only">{spokenStatus}</span> : null}

          {!isDone && !isAvailable ? (
            <Badge variant="muted" className="mt-px">
              Being built
            </Badge>
          ) : null}
        </div>

        {isFocus ? (
          <>
            <p className="text-xs leading-snug text-muted-foreground">{meta.description}</p>
            <Link href={meta.href} className={cn(buttonVariants({ size: 'sm' }), 'mt-0.5 self-start')}>
              {meta.action}
              <ArrowRight aria-hidden />
            </Link>
          </>
        ) : null}
      </div>
    </li>
  );
}

function StepTitle({
  title,
  href,
  asLink,
  isDone,
  isFocus,
}: {
  title: string;
  href: string;
  asLink: boolean;
  isDone: boolean;
  isFocus: boolean;
}) {
  if (asLink) {
    return (
      <Link
        href={href}
        className="text-sm font-medium text-foreground transition-colors duration-instant ease-out hover:text-primary"
      >
        {title}
      </Link>
    );
  }

  return (
    <span
      className={cn(
        'text-sm',
        isDone && 'text-muted-foreground',
        isFocus && 'font-medium text-foreground',
        !isDone && !isFocus && 'text-foreground',
      )}
    >
      {title}
    </span>
  );
}

/**
 * One 20px disc for all three states, differing only in fill. Done, next and not-yet-started
 * share a geometry so the column reads as a single track rather than as three unrelated glyphs
 * — a filled tick, a ringed dot and an outline circle at different optical weights.
 */
function StepMarker({ isDone, isFocus }: { isDone: boolean; isFocus: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
        isDone && 'border-success-border bg-success-surface text-success',
        !isDone && isFocus && 'border-primary bg-card',
        !isDone && !isFocus && 'border-border bg-card',
      )}
    >
      {isDone ? (
        <Check className="size-3" />
      ) : isFocus ? (
        <span className="size-1.5 rounded-full bg-primary" />
      ) : null}
    </span>
  );
}
