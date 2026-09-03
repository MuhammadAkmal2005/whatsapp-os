import { Badge } from '@/components/ui/badge';

/**
 * An automation, drawn the way it reads in the builder: a trigger, then the steps that follow.
 *
 * Kept to one real rule rather than an abstract diagram of nodes and edges. "Two days after
 * delivery, ask how it fits, and stop if they reply" is a thing a shop owner recognises; a
 * flowchart of empty boxes is not.
 */

const STEPS = [
  {
    kind: 'When',
    title: 'An order is marked delivered',
    detail: 'Any order, any customer.',
  },
  {
    kind: 'Wait',
    title: '2 days',
    detail: 'Long enough that they have actually opened the parcel.',
  },
  {
    kind: 'Send',
    title: 'Ask how the fit was',
    detail: 'Inside the 24-hour window, or as an approved template outside it.',
  },
  {
    kind: 'Stop if',
    title: 'They have already replied',
    detail: 'No one gets chased for answering.',
  },
] as const;

export function AutomationMock() {
  return (
    <div className="flex flex-col gap-3 bg-card p-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-foreground">Post-delivery check-in</p>
        <Badge variant="success" size="sm" dot className="ml-auto shrink-0">
          Active
        </Badge>
      </div>

      <ol className="flex flex-col">
        {STEPS.map((step, index) => (
          <li key={step.kind} className="flex gap-3">
            {/* The rail is the connector: a line down the gutter, stopped short on the last
                row so the sequence has an end rather than trailing off. */}
            <div className="flex w-4 shrink-0 flex-col items-center">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
              {index < STEPS.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
            </div>
            <div className={index < STEPS.length - 1 ? 'pb-3.5' : ''}>
              <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                {step.kind}
              </p>
              <p className="mt-0.5 text-xs font-medium text-foreground">{step.title}</p>
              <p className="mt-0.5 text-3xs leading-relaxed text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
