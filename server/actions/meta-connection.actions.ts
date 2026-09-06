'use server';

/**
 * Server actions for connecting WhatsApp through Meta's Embedded Signup dialog.
 *
 * The browser's only job in this flow is to run Meta's dialog and hand back what Meta gave
 * it: an authorization code and the asset ids the business selected. Every one of those
 * values is treated as a claim. The code is exchanged here with the app secret, the ids are
 * checked against Meta with the resulting token, and the workspace comes from the session's
 * tenant context — never from the payload.
 *
 * The state token is the CSRF binding. It is minted by `startEmbeddedSignupAction` for the
 * current workspace and membership, and the callback refuses a state that was issued to
 * anyone else, so a code captured elsewhere cannot be posted into this workspace.
 */

import { revalidatePath } from 'next/cache';

import { isEmbeddedSignupConfigured } from '@/config/env';
import type { FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { ForbiddenError, ValidationError } from '@/server/errors';
import { completeEmbeddedSignup } from '@/server/services/whatsapp/meta-onboarding.service';
import {
  runConnectionHealthCheck,
  type ConnectionHealthReport,
} from '@/server/services/whatsapp/meta-connection-health.service';
import {
  createSignupState,
  signupStateMatchesActor,
  verifySignupState,
} from '@/server/services/whatsapp/meta-signup-state';
import { can } from '@/server/tenancy/context';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  completeEmbeddedSignupSchema,
  runConnectionHealthCheckSchema,
} from '@/server/validation/meta-connection';

function revalidateWhatsAppSettings() {
  revalidatePath('/settings/whatsapp');
  revalidatePath('/conversations');
  revalidatePath('/inbox');
}

export type StartEmbeddedSignupResult =
  | { ok: true; state: string }
  | { ok: false; message: string };

/**
 * Issues the signed state a signup attempt must carry.
 *
 * Returns a result object rather than throwing, because the caller is a button handler and
 * a missing deployment configuration is a message to render, not an error page.
 */
export async function startEmbeddedSignupAction(): Promise<StartEmbeddedSignupResult> {
  if (!isEmbeddedSignupConfigured) {
    return {
      ok: false,
      message:
        'Connecting through Meta is not set up on this deployment yet. You can connect with an access token instead.',
    };
  }

  try {
    const ctx = await requireTenantContext();
    if (!can(ctx, 'whatsapp:connect')) {
      throw new ForbiddenError('You do not have permission to connect WhatsApp.');
    }

    return {
      ok: true,
      state: createSignupState({
        workspaceId: ctx.workspaceId,
        membershipId: ctx.membershipId,
      }),
    };
  } catch (error) {
    const formState = formErrorFrom(error);
    return { ok: false, message: formState.message ?? 'Could not start the connection.' };
  }
}

/**
 * Finishes a signup: verifies the state, exchanges the code, connects the number.
 *
 * Runs inline rather than through the job queue because Meta's authorization code lives
 * about thirty seconds — long enough for one server-side exchange and nothing else.
 */
export async function completeEmbeddedSignupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = completeEmbeddedSignupSchema.safeParse({
    code: formData.get('code'),
    wabaId: formData.get('wabaId'),
    phoneNumberId: formData.get('phoneNumberId'),
    state: formData.get('state'),
  });

  if (!parsed.success) {
    return validationFormState(parsed.error);
  }

  try {
    const ctx = await requireTenantContext();

    const claims = verifySignupState(parsed.data.state);
    if (
      !signupStateMatchesActor(claims, {
        workspaceId: ctx.workspaceId,
        membershipId: ctx.membershipId,
      })
    ) {
      // One message for every failure mode. Distinguishing expired from forged would tell
      // an attacker which half of the token to work on.
      throw new ValidationError(
        'This connection attempt is no longer valid. Please start connecting again.',
      );
    }

    const result = await completeEmbeddedSignup(ctx, {
      code: parsed.data.code,
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
    });

    revalidateWhatsAppSettings();

    if (result.status === 'CONNECTED') {
      return {
        status: 'success',
        message: `${result.displayPhoneNumber} is connected. Customers messaging this number will reach your inbox.`,
      };
    }

    // A partial connection is reported as a partial connection. The account row carries the
    // same sentence, so the settings page and this toast cannot disagree.
    return {
      status: 'success',
      message:
        result.warnings[0]?.message ??
        `${result.displayPhoneNumber} is connected but needs attention. Check the connection details below.`,
    };
  } catch (error) {
    return formErrorFrom(error);
  }
}

export type ConnectionHealthResult =
  | { ok: true; report: ConnectionHealthReport }
  | { ok: false; message: string };

/**
 * Re-asks Meta about one connection, on the owner's explicit request.
 *
 * Forces past the TTL because the button exists precisely for the moment after someone
 * fixed something in Business Manager and wants to know whether it took. The report is
 * returned rather than only revalidated so the panel can show which specific check moved.
 */
export async function runConnectionHealthCheckAction(
  input: unknown,
): Promise<ConnectionHealthResult> {
  const parsed = runConnectionHealthCheckSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'That connection could not be checked.' };
  }

  try {
    const ctx = await requireTenantContext();
    const report = await runConnectionHealthCheck(ctx, parsed.data.accountId, { force: true });

    revalidateWhatsAppSettings();

    return { ok: true, report };
  } catch (error) {
    const formState = formErrorFrom(error);
    return { ok: false, message: formState.message ?? 'Could not check this connection.' };
  }
}
