import { AutomationFormSkeleton } from '@/components/automation/automation-form-skeleton';

/** Shown while one automation and its recent runs load. */
export default function AutomationDetailLoading() {
  return <AutomationFormSkeleton title="Loading this automation…" />;
}
