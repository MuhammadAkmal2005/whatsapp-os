'use client';

/**
 * The two numeric dials, and the one read-only fact worth showing.
 *
 * There is no model picker, and that is a finding rather than an omission. `env.AI_PROVIDER`
 * selects the adapter; only Gemini and the mock have one; and no identifier in the model
 * catalogue is one the Gemini adapter can serve. A picker would therefore have to offer either a
 * value that fails at request time or an entry invented for the occasion. So the model the
 * deployment stamped on the assistant is shown as what it is — a fact about this deployment — and
 * the mock is labelled out loud, because an owner whose assistant is answering with canned text
 * has to be able to find that out from the screen rather than from a support conversation.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { AGENT_CONFIG_LIMITS } from '@/config/constants';
import type { FieldErrors } from '@/lib/form-state';

export function AgentBehaviourCard({
  temperature,
  maxOutputTokens,
  model,
  providerIsMock,
  fieldErrors,
  disabled = false,
}: {
  temperature: string;
  maxOutputTokens: string;
  model: string;
  providerIsMock: boolean;
  fieldErrors?: FieldErrors;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fine tuning</CardTitle>
        <CardDescription>
          Sensible defaults are already set. Change these only if replies are consistently too
          samey or too long.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={fieldErrors?.temperature?.[0]}>
            <FormLabel>Wording variety</FormLabel>
            <FormControl>
              <Input
                name="temperature"
                type="number"
                inputMode="decimal"
                defaultValue={temperature}
                disabled={disabled}
                required
                min={AGENT_CONFIG_LIMITS.temperatureMin}
                max={AGENT_CONFIG_LIMITS.temperatureMax}
                step={0.05}
              />
            </FormControl>
            <FormDescription>
              Between {AGENT_CONFIG_LIMITS.temperatureMin} and {AGENT_CONFIG_LIMITS.temperatureMax}
              . Lower means your assistant answers the same question the same way every time.
              Higher varies the wording. It does not change the facts either way.
            </FormDescription>
          </FormField>

          <FormField error={fieldErrors?.maxOutputTokens?.[0]}>
            <FormLabel>Longest reply</FormLabel>
            <FormControl>
              <Input
                name="maxOutputTokens"
                type="number"
                inputMode="numeric"
                defaultValue={maxOutputTokens}
                disabled={disabled}
                required
                min={AGENT_CONFIG_LIMITS.maxOutputTokensMin}
                max={AGENT_CONFIG_LIMITS.maxOutputTokensMax}
                step={1}
              />
            </FormControl>
            <FormDescription>
              Between {AGENT_CONFIG_LIMITS.maxOutputTokensMin} and{' '}
              {AGENT_CONFIG_LIMITS.maxOutputTokensMax}, counted in tokens — roughly four characters
              each. The default of 600 is comfortably enough for a full answer about a product.
            </FormDescription>
          </FormField>
        </div>

        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">AI engine</span>
            <Badge variant={providerIsMock ? 'warning' : 'ai'}>{model}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {providerIsMock
              ? 'This workspace is running in test mode. Replies are placeholder text, not real AI, and no customer sees them. Nothing here needs changing — your settings are saved and will be used once a live engine is connected.'
              : 'Set for you, and not something you need to choose. Your plan decides which engine answers your customers.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
