import { AutomationFormSkeleton } from '@/components/automation/automation-form-skeleton';

/** Shown while the new-automation page loads its trigger and action vocabularies. */
export default function NewAutomationLoading() {
  return <AutomationFormSkeleton title="Loading the automation builder…" />;
}
