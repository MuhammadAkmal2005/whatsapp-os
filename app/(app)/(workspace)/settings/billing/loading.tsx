import {
  SettingsPlanCardSkeleton,
  SettingsSkeletonGroup,
  SettingsUsageCardSkeleton,
} from '@/components/settings/settings-skeleton';

/**
 * Shown while the plan, the subscription and the workspace's quota usage are read.
 *
 * Billing opens with the plan the workspace is on and then what it is using of it, so those two
 * cards are drawn at their real geometry. The plan comparison grid below them is not: four plan
 * cards are a long way down the page, and a reader waiting for this screen is looking at the top
 * of it.
 */
export default function BillingSettingsLoading() {
  return (
    <SettingsSkeletonGroup label="Loading billing…">
      <SettingsPlanCardSkeleton />
      <SettingsUsageCardSkeleton />
    </SettingsSkeletonGroup>
  );
}
