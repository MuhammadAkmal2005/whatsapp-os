import {
  SettingsFormCardSkeleton,
  SettingsPeopleCardSkeleton,
  SettingsSkeletonGroup,
} from '@/components/settings/settings-skeleton';

/**
 * Shown when someone arrives in settings from elsewhere in the product.
 *
 * At that point the changing segment is `settings` itself, so this is the boundary Next opens
 * whichever section is being loaded — and it cannot know which one that is. Every section opens
 * the same way, a card of fields over a card of rows, so it draws that rather than a guess at any
 * one screen. Once inside, switching sections is covered by each section's own boundary.
 */
export default function SettingsLoading() {
  return (
    <SettingsSkeletonGroup label="Loading settings…">
      <SettingsFormCardSkeleton />
      <SettingsPeopleCardSkeleton />
    </SettingsSkeletonGroup>
  );
}
