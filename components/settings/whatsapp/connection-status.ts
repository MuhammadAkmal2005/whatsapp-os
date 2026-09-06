/**
 * The words this product uses for the state of a WhatsApp connection.
 *
 * One module because three components render the same five states and a fourth reads the
 * health checks behind them. When the vocabulary lived on the card, a badge and a panel
 * could disagree about whether `DEGRADED` meant "broken" or "needs a look", and the owner
 * had no way to tell which was right.
 *
 * The mapping from the stored `ChannelStatus` to what a shop owner reads:
 *
 *   DISCONNECTED → "Disconnected"      the token is gone; nothing arrives
 *   PENDING      → "Connecting"        we are waiting on Meta to finish something
 *   CONNECTED    → "Connected"         Meta confirmed delivery and the number can send
 *   DEGRADED     → "Needs attention"   partly working, with a reason we can state
 *   ERROR        → "Not working"       Meta refused our last real request
 *
 * "Not connected" — the sixth state in the brief — is the absence of an account row, so it
 * belongs to the page rather than to a status column, and it is the connect card's job.
 *
 * Client-safe: types only, no server imports, so a client component can render a state
 * without pulling a service into the browser bundle.
 */

import type { HealthCheckName, HealthCheckState } from '@/server/services/whatsapp/meta-connection-health.service';
import type { WhatsAppAccountOverviewDTO } from '@/server/services/whatsapp/whatsapp-account.service';

export type ConnectionStatus = WhatsAppAccountOverviewDTO['status'];

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  CONNECTED: 'Connected',
  PENDING: 'Connecting',
  // "Needs attention" rather than "Degraded": the number still works for some things,
  // and the owner's next action is to look, not to panic.
  DEGRADED: 'Needs attention',
  ERROR: 'Not working',
  DISCONNECTED: 'Disconnected',
};

export const CONNECTION_STATUS_TONES: Record<ConnectionStatus, StatusTone> = {
  CONNECTED: 'success',
  PENDING: 'warning',
  DEGRADED: 'warning',
  ERROR: 'danger',
  DISCONNECTED: 'muted',
};

/**
 * One sentence per state, in terms of what is happening to the owner's messages.
 *
 * Every one of them answers the only question that matters on this screen: are my
 * customers being reached. A status word on its own does not.
 */
export const CONNECTION_STATUS_SUMMARIES: Record<ConnectionStatus, string> = {
  CONNECTED:
    'Customer messages reach your inbox and your replies reach WhatsApp.',
  PENDING:
    'Meta has not finished setting this number up yet, so messages may not arrive.',
  DEGRADED:
    'Part of this connection is not working. Some messages may not arrive or may not send.',
  ERROR:
    'WhatsApp refused our last request for this number. Replies are failing until it is fixed.',
  DISCONNECTED:
    'This number no longer carries messages. Everything already recorded is kept.',
};

/** What each health check actually establishes, as a short heading. */
export const HEALTH_CHECK_LABELS: Record<HealthCheckName, string> = {
  token_present: 'Permission to use your number',
  token_expiry: 'How long that permission lasts',
  phone_number_readable: 'Meta recognises your number',
  webhook_subscription: 'Incoming messages are routed here',
  recent_activity: 'Messages have flowed recently',
};

export const HEALTH_CHECK_TONES: Record<HealthCheckState, StatusTone> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  skipped: 'muted',
};

export const HEALTH_CHECK_STATE_LABELS: Record<HealthCheckState, string> = {
  pass: 'Working',
  warn: 'Worth a look',
  fail: 'Not working',
  skipped: 'Not checked',
};
