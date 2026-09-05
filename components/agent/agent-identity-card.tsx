'use client';

/**
 * Who the assistant is: its name, its job, and how it sounds.
 *
 * Role and tone are held in local state rather than left to `defaultValue` alone, because both
 * pickers show what the choice means underneath them. The role one is not decoration: the
 * runtime grants order-writing tools from this field, so a shop owner switching from "Helps with
 * questions" to "Sells and helps" is granting their assistant permission to place orders. That
 * sentence appears the moment the option changes, not after a save.
 */

import { useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormControl, FormDescription, FormField, FormLabel } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_CONFIG_LIMITS } from '@/config/constants';
import {
  AGENT_ROLE_DESCRIPTIONS,
  AGENT_ROLE_LABELS,
  AGENT_TONE_DESCRIPTIONS,
  AGENT_TONE_LABELS,
} from '@/lib/labels';
import type { FieldErrors } from '@/lib/form-state';
import {
  AGENT_ROLES,
  AGENT_TONES,
  ORDER_CAPABLE_AGENT_ROLES,
  type AgentRoleValue,
  type AgentToneValue,
} from '@/server/validation/agent';

export function AgentIdentityCard({
  name,
  role,
  tone,
  persona,
  fieldErrors,
  disabled = false,
}: {
  name: string;
  role: AgentRoleValue;
  tone: AgentToneValue;
  persona: string;
  fieldErrors?: FieldErrors;
  disabled?: boolean;
}) {
  const [selectedRole, setSelectedRole] = useState<AgentRoleValue>(role);
  const [selectedTone, setSelectedTone] = useState<AgentToneValue>(tone);

  const canPlaceOrders = ORDER_CAPABLE_AGENT_ROLES.includes(selectedRole);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your assistant</CardTitle>
        <CardDescription>
          The name customers see, the job it does, and the way it writes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FormField error={fieldErrors?.name?.[0]}>
          <FormLabel>Name</FormLabel>
          <FormControl>
            <Input
              name="name"
              defaultValue={name}
              disabled={disabled}
              required
              autoComplete="off"
              placeholder="e.g. Sana"
              maxLength={AGENT_CONFIG_LIMITS.nameMax}
            />
          </FormControl>
          <FormDescription>
            Your assistant introduces itself by this name in chats. A real first name reads better
            than &ldquo;Support Bot&rdquo;.
          </FormDescription>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={fieldErrors?.role?.[0]}>
            <FormLabel>Job</FormLabel>
            <FormControl>
              <NativeSelect
                name="role"
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value as AgentRoleValue)}
                disabled={disabled}
              >
                {AGENT_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {AGENT_ROLE_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormDescription>{AGENT_ROLE_DESCRIPTIONS[selectedRole]}</FormDescription>
          </FormField>

          <FormField error={fieldErrors?.tone?.[0]}>
            <FormLabel>Style</FormLabel>
            <FormControl>
              <NativeSelect
                name="tone"
                value={selectedTone}
                onChange={(event) => setSelectedTone(event.target.value as AgentToneValue)}
                disabled={disabled}
              >
                {AGENT_TONES.map((option) => (
                  <option key={option} value={option}>
                    {AGENT_TONE_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </FormControl>
            <FormDescription>{AGENT_TONE_DESCRIPTIONS[selectedTone]}</FormDescription>
          </FormField>
        </div>

        {/* Stated as a consequence of the job, because it is the only setting on this screen
            that changes what the assistant is allowed to do rather than how it sounds. */}
        <p className="text-sm text-muted-foreground">
          {canPlaceOrders
            ? 'With this job, your assistant can place an order for a customer. Prices and totals always come from your catalogue, never from the assistant.'
            : 'With this job, your assistant cannot place orders. A customer ready to buy is handed to your team.'}
        </p>

        <FormField error={fieldErrors?.persona?.[0]}>
          <FormLabel>Style note</FormLabel>
          <FormControl>
            <Textarea
              name="persona"
              defaultValue={persona}
              disabled={disabled}
              placeholder="e.g. Warm and quick. Uses Roman Urdu when the customer does. Never pushes a sale."
              maxLength={AGENT_CONFIG_LIMITS.personaMax}
            />
          </FormControl>
          <FormDescription>
            Optional. A sentence or two on how your assistant should come across, on top of the
            style above.
          </FormDescription>
        </FormField>
      </CardContent>
    </Card>
  );
}
