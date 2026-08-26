import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ONBOARDING_STEPS, ONBOARDING_STEP_META } from '@/config/constants';
import { cn } from '@/lib/utils';

/**
 * Destinations that exist today. A step links to its screen only once that
 * screen ships; until then it renders as an upcoming item with a "Soon" chip,
 * never as a link to a page that would 404. Add an href here when its screen
 * lands — the checklist lights up on its own from the real completion data.
 */
const LIVE_STEP_HREFS = new Set<string>(['/dashboard']);

type OnboardingChecklistProps = {
  completedSteps: readonly string[];
  className?: string;
};

/**
 * The setup checklist, driven entirely by the workspace's real
 * `onboardingCompletedSteps`. The first incomplete step is the "next" one and
 * gets the call to action; earlier steps show as done, later ones as upcoming.
 * Server-rendered — it only reads data and holds no state.
 */
export function OnboardingChecklist({ completedSteps, className }: OnboardingChecklistProps) {
  const done = new Set(completedSteps);
  const total = ONBOARDING_STEPS.length;
  const completedCount = ONBOARDING_STEPS.filter((step) => done.has(step)).length;
  const nextStep = ONBOARDING_STEPS.find((step) => !done.has(step)) ?? null;
  const percent = Math.round((completedCount / total) * 100);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Finish setting up</CardTitle>
          <span className="shrink-0 text-sm font-medium text-muted-foreground">
            {completedCount} of {total}
          </span>
        </div>
        <CardDescription>A few steps to get your AI answering customers.</CardDescription>
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Setup progress"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      </CardHeader>

      <CardContent>
        <ol className="flex flex-col gap-1">
          {ONBOARDING_STEPS.map((step) => {
            const meta = ONBOARDING_STEP_META[step];
            const isDone = done.has(step);
            const isNext = step === nextStep;
            const isLive = LIVE_STEP_HREFS.has(meta.href);

            return (
              <li
                key={step}
                className={cn(
                  'flex items-start gap-3 rounded-lg px-2 py-2',
                  isNext && 'bg-accent',
                )}
              >
                <span className="mt-0.5 shrink-0" aria-hidden>
                  {isDone ? (
                    <CheckCircle2 className="size-5 text-success" />
                  ) : isNext ? (
                    <span className="flex size-5 items-center justify-center rounded-full border-2 border-primary">
                      <span className="size-1.5 rounded-full bg-primary" />
                    </span>
                  ) : (
                    <Circle className="size-5 text-muted-foreground/40" />
                  )}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      isDone ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {meta.title}
                  </span>
                  {isNext ? (
                    <span className="text-xs text-muted-foreground">{meta.description}</span>
                  ) : null}
                </div>

                {isDone ? (
                  <span className="mt-0.5 shrink-0 text-xs font-medium text-success">Done</span>
                ) : isNext && isLive ? (
                  <Link
                    href={meta.href}
                    className={cn(buttonVariants({ size: 'sm' }), 'shrink-0 gap-1.5')}
                  >
                    Continue
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                ) : !isDone ? (
                  <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    Soon
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
