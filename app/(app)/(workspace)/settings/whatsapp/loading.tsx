import {
  SettingsFormCardSkeleton,
  SettingsSkeletonGroup,
} from '@/components/settings/settings-skeleton';

/**
 * Shown while the workspace's WhatsApp connection is read.
 *
 * This screen resolves to one of three things — the connected number's card, the form for
 * connecting one, or an explanation for a role that cannot — and they are different heights, so
 * this draws only what all three share: one card with a title, a line of explanation, and a body.
 * Under-drawing costs a downward reflow when the real card is taller, which moves nothing the
 * reader has begun reading; over-drawing would collapse the page under them.
 */
export default function WhatsAppSettingsLoading() {
  return (
    <SettingsSkeletonGroup label="Loading WhatsApp settings…">
      <SettingsFormCardSkeleton />
    </SettingsSkeletonGroup>
  );
}
