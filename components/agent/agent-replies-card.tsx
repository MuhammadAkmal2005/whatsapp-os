'use client';

/**
 * What the assistant knows to say, and how it opens.
 *
 * The greeting wording is deliberate. The runtime passes this line to the model as
 * `Default Greeting:` guidance inside the system prompt — nothing in the product sends it on its
 * own, and there is no trigger that would. Copy that promised "we send this first" would describe
 * a feature that does not exist, so it says "opens with" instead.
 *
 * One instructions box, not two. The database also carries an `instructions[]` relation that the
 * prompt appends under "Additional Guidelines", but no code path writes a row to it, so a second
 * textarea would be a control for a feature with no data behind it.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_CONFIG_LIMITS } from '@/config/constants';
import type { FieldErrors } from '@/lib/form-state';

export function AgentRepliesCard({
  greeting,
  customInstructions,
  fieldErrors,
  disabled = false,
}: {
  greeting: string;
  customInstructions: string;
  fieldErrors?: FieldErrors;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How it replies</CardTitle>
        <CardDescription>
          Your own instructions, in your own words. This is where you tell your assistant the
          things only you know about your business.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormField error={fieldErrors?.greeting?.[0]}>
          <FormLabel>Opening line</FormLabel>
          <FormControl>
            <Textarea
              name="greeting"
              defaultValue={greeting}
              disabled={disabled}
              placeholder="e.g. Assalam o Alaikum! Main aap ki kya madad kar sakti hoon?"
              maxLength={AGENT_CONFIG_LIMITS.greetingMax}
            />
          </FormControl>
          <FormDescription>
            How your assistant opens when a customer messages first. It follows this line rather
            than repeating it word for word, and it replies in the language the customer wrote in.
          </FormDescription>
        </FormField>

        <FormField error={fieldErrors?.customInstructions?.[0]}>
          <FormLabel>Instructions</FormLabel>
          <FormControl>
            <Textarea
              name="customInstructions"
              defaultValue={customInstructions}
              disabled={disabled}
              className="min-h-40"
              placeholder={
                'e.g.\nDelivery is 2–3 days in Karachi and Lahore, 4–5 days elsewhere.\nCOD is available everywhere. Advance payment gets Rs. 200 off.\nExchanges within 7 days if the tags are still on. No refunds.\nIf someone asks for a discount, offer the bundle deal before agreeing to anything.'
              }
              maxLength={AGENT_CONFIG_LIMITS.customInstructionsMax}
            />
          </FormControl>
          <FormDescription>
            Your rules, in plain sentences — delivery, payment, exchanges, anything you would tell
            a new member of staff on their first day. Your assistant will not state a price,
            stock figure or order status it cannot look up, so this is for the things it has no
            other way of knowing.
          </FormDescription>
        </FormField>
      </CardContent>
    </Card>
  );
}
