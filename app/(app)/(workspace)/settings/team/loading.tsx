import {
  SettingsFormCardSkeleton,
  SettingsPeopleCardSkeleton,
  SettingsSkeletonGroup,
} from '@/components/settings/settings-skeleton';

/**
 * Shown while the team roster and any pending invitations are read.
 *
 * The screen is an invite form over the list of people in the workspace, which is exactly the
 * pair below. The pending-invitations card is left out: it renders only when an invitation is
 * outstanding, and a placeholder for a card that usually is not there would collapse for most
 * readers on most visits.
 */
export default function TeamSettingsLoading() {
  return (
    <SettingsSkeletonGroup label="Loading your team…">
      <SettingsFormCardSkeleton />
      <SettingsPeopleCardSkeleton />
    </SettingsSkeletonGroup>
  );
}
