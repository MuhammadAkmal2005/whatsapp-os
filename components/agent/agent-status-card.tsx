'use client';

/**
 * The on/off switch, and the sentence that says what off actually means.
 *
 * Controlled from the form shell rather than held here, so the save bar can warn before an owner
 * commits a change whose effect is invisible on this screen — a switched-off assistant looks
 * exactly the same here as a switched-on one.
 *
 * A Radix switch posts nothing, so the hidden input carries the value. Always 'true' or 'false',
 * never absent: `flagInput` reads a missing field as false, and "the browser left it off the post"
 * must not be indistinguishable from "the owner switched the assistant off".
 *
 * The toggle hangs off `onClick`, not `onCheckedChange`, and that is not a stylistic choice.
 * Radix restores a switch to its mount-time value whenever the surrounding form resets — which is
 * what React does to a `<form action>` after every save — and it announces that restore through
 * `onCheckedChange` from an effect, so it lands after any attempt to correct it. Wired to state,
 * that turns a saved "off" back into the "on" it was before the save, and the hidden input follows,
 * so the *next* save silently reposts the stale value. `onClick` fires only for a real click or a
 * keyboard activation of the button, which is the only signal that means the owner chose something.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

export function AgentStatusCard({
  isActive,
  onToggle,
  disabled = false,
}: {
  isActive: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Answering customers</CardTitle>
        <CardDescription>
          Turn this off when you would rather answer everything yourself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div className="min-w-0">
            <label htmlFor="agent-is-active" className="text-sm font-medium text-foreground">
              Reply to customers automatically
            </label>
            <p className="mt-1 text-sm text-muted-foreground">
              {isActive
                ? 'Your assistant answers new messages on its own, and hands a chat to your team when it should.'
                : 'Your assistant will not reply to anybody. Messages still arrive in your inbox for your team to answer by hand.'}
            </p>
          </div>
          <Switch
            id="agent-is-active"
            checked={isActive}
            onClick={onToggle}
            disabled={disabled}
            aria-label="Reply to customers automatically"
          />
          <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
        </div>
      </CardContent>
    </Card>
  );
}
