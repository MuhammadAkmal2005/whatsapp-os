/**
 * The first thing a business sees on this screen, and the most important copy on it.
 *
 * A shop owner arriving here has no idea what "knowledge" means to an assistant, and an empty
 * table with an Add button teaches them nothing. So the examples are the explanation: three
 * short pieces of the sort of thing they already answer twenty times a day, written the way
 * they would say it. Anyone reading them knows immediately whether they have something to add.
 *
 * The examples are specific on purpose — real cities, real charges, a real exchange window.
 * "Add information about your delivery policy" invites a vague sentence that answers nothing;
 * "Lahore and Karachi in 2–3 days, Rs. 250 delivery" shows the shape of an answer a customer
 * can act on.
 *
 * A viewer sees the same explanation without the buttons. Telling them who to ask is better
 * than a screen that looks broken, and better than offering an action that would be refused.
 */

import { BookOpen } from 'lucide-react';

import { AddKnowledgeActions } from '@/components/knowledge/add-knowledge-actions';
import { EmptyState } from '@/components/ui/empty-state';

const EXAMPLES = [
  {
    label: 'Delivery',
    body: 'All over Pakistan. Lahore and Karachi in 2–3 days, other cities in 3–5 days. Rs. 250 delivery, free over Rs. 3,000.',
  },
  {
    label: 'Exchange and returns',
    body: 'Exchange within 7 days if the item is unused with its tags still on.',
  },
  {
    label: 'Payment',
    body: 'Cash on delivery everywhere, or bank transfer for advance orders.',
  },
] as const;

export function KnowledgeEmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <EmptyState
      icon={BookOpen}
      title="Teach your assistant about your business"
      description="Write down what you tell customers over and over. Your assistant answers from what is here — and says it does not know rather than guessing when something is missing."
      action={canCreate ? <AddKnowledgeActions /> : undefined}
      secondaryAction={
        <div className="mx-auto max-w-md text-left">
          <p className="mb-2 text-center font-medium text-foreground">Things worth adding</p>
          <dl className="flex flex-col gap-2">
            {EXAMPLES.map((example) => (
              <div key={example.label}>
                <dt className="text-foreground">{example.label}</dt>
                <dd>{example.body}</dd>
              </div>
            ))}
          </dl>
          {canCreate ? null : (
            <p className="mt-3 text-center">Ask an owner or manager to add these for you.</p>
          )}
        </div>
      }
    />
  );
}
