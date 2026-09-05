'use client';

/**
 * The words that pull a chat away from the assistant and hand it to a person.
 *
 * A textarea rather than a chip editor, because one word per line is a shape everybody already
 * understands and it makes a list of twenty editable without twenty small buttons. The chips
 * below it are a preview of what will actually be stored: trimmed, lower-cased and de-duplicated.
 *
 * The matching is a substring test against the customer's message, and the help text says so.
 * Hardening that comparison to whole words is its own change with its own regression risk; until
 * then, an owner choosing their words deserves to know that "ref" will also catch "reference".
 */

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_CONFIG_LIMITS } from '@/config/constants';
import type { FieldErrors } from '@/lib/form-state';
import { normaliseHandoffKeywords, parseHandoffKeywordList } from '@/server/validation/agent';

export function AgentHandoverCard({
  keywords,
  fieldErrors,
  disabled = false,
}: {
  keywords: string;
  fieldErrors?: FieldErrors;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState(keywords);

  // The same two functions the server runs, so the preview cannot disagree with what is saved.
  const normalised = normaliseHandoffKeywords(parseHandoffKeywordList(raw));
  const overLimit = normalised.length > AGENT_CONFIG_LIMITS.handoffKeywordsMax;

  return (
    <Card>
      <CardHeader>
        <CardTitle>When to fetch a person</CardTitle>
        <CardDescription>
          If a customer&rsquo;s message contains one of these words, your assistant stops replying
          and the chat is handed to your team.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormField error={fieldErrors?.handoffKeywords?.[0]}>
          <FormLabel>Handover words</FormLabel>
          <FormControl>
            <Textarea
              name="handoffKeywords"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              disabled={disabled}
              className="min-h-32"
              placeholder={'manager\ncomplaint\nrefund\nshikayat\nbaat karni hai'}
            />
          </FormControl>
          <FormDescription>
            One per line. Capitals do not matter. A word is matched anywhere inside a message, so
            &ldquo;ref&rdquo; would also catch &ldquo;reference&rdquo; — pick words you would only
            see when someone genuinely wants a person.
          </FormDescription>
        </FormField>

        {normalised.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {normalised.length} of {AGENT_CONFIG_LIMITS.handoffKeywordsMax} words will be saved
            </p>
            <div className="flex flex-wrap gap-1.5">
              {normalised.map((keyword) => (
                <Badge key={keyword} variant={overLimit ? 'warning' : 'muted'}>
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No handover words yet. Your team can still take over any chat by hand from the inbox.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
