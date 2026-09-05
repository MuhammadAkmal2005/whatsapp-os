'use server';

/**
 * Knowledge server actions.
 *
 * Thin adapters: parse the form, delegate, translate the outcome. Every one resolves its own
 * tenant context, so the workspace comes from the session cookie and never from the form —
 * a crafted post cannot add a document to, or delete one from, another business.
 *
 * None of these check permissions. `requirePermission` runs inside the service, which is the
 * single place the page, a future API route and any other caller all pass through. The
 * capability flags the page uses to decide which buttons to draw are a convenience; a form
 * post does not have to come from a page we rendered.
 *
 * `revalidatePath` rather than a redirect, on every one of them. The list is where all five
 * actions are performed from and where their result is read, so the person stays put and the
 * row they just changed re-renders underneath the dialog they closed.
 */

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import { type FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { getRequestMeta, type RequestMeta } from '@/server/http/request-meta';
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocumentSource,
  retryKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/server/services/knowledge/knowledge.service';
import type { TenantContext } from '@/server/tenancy/context';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  createKnowledgeDocumentSchema,
  knowledgeDocumentId,
  knowledgeDocumentRefSchema,
  updateKnowledgeDocumentSchema,
  type KnowledgeDocumentSource,
} from '@/server/validation/knowledge';

const KNOWLEDGE_PATH = '/knowledge';

/**
 * The fields a text document posts.
 *
 * `?? undefined` rather than `?? ''`, so a field the form did not send is reported as
 * missing by the schema instead of as empty. The two produce different sentences, and
 * "write something here" is the wrong message for a form that is broken.
 */
function textFieldsFrom(formData: FormData) {
  return {
    type: 'TEXT' as const,
    title: formData.get('title') ?? undefined,
    content: formData.get('content') ?? undefined,
  };
}

function faqFieldsFrom(formData: FormData) {
  return {
    type: 'FAQ' as const,
    title: formData.get('title') ?? undefined,
    question: formData.get('question') ?? undefined,
    answer: formData.get('answer') ?? undefined,
  };
}

/**
 * What `safeParse` returns, narrowed to the two properties this file uses.
 *
 * Written out rather than imported as `SafeParseReturnType` because that type is generic in
 * the schema's *input* as well as its output, and naming the input here would tie every
 * action to the raw `FormData` shape it happens to pass in today.
 */
type ParsedInput<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: z.ZodError };

/**
 * The body all five actions share.
 *
 * Worth writing once for a reason beyond repetition: the `catch` is what turns the duplicate
 * index firing into "you have already saved this" instead of "something went wrong", and an
 * action that forgot it would look correct in review and be wrong only on the path nobody
 * clicks twice on purpose.
 *
 * The tenant context is resolved here, from the session cookie, and handed to the service.
 * Nothing reads a workspace id out of `formData` — that is the difference between a form post
 * and a way into another business's knowledge.
 */
async function perform<T>(
  parsed: ParsedInput<T>,
  run: (context: TenantContext, input: T, meta: RequestMeta) => Promise<unknown>,
  successMessage: string,
): Promise<FormState> {
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const context = await requireTenantContext();
    await run(context, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(KNOWLEDGE_PATH);
  return { status: 'success', message: successMessage };
}

const SAVED_MESSAGE = 'Saved. Your assistant is reading it now — this usually takes a moment.';
const UPDATED_MESSAGE = 'Updated. Your assistant is reading the new version now.';

/**
 * Saves a piece of text: new when the form carries no id, a replacement when it does.
 *
 * One action for both, because it is one dialog. Two actions would mean the form's `action`
 * prop changes identity between adding and editing, which resets the pending state and drops
 * the message the person was reading.
 *
 * Which id arrives decides which permission is needed, and the services decide that, not this
 * function: no id takes the create path and `knowledge:create`, an id takes the update path
 * and `knowledge:update`. A post that invents an id it does not own gets `NotFoundError`.
 */
export async function saveTextKnowledgeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = formData.get('documentId');

  if (documentId === null || documentId === '') {
    return perform(
      createKnowledgeDocumentSchema.safeParse(textFieldsFrom(formData)),
      createKnowledgeDocument,
      SAVED_MESSAGE,
    );
  }

  return perform(
    updateKnowledgeDocumentSchema.safeParse({ ...textFieldsFrom(formData), documentId }),
    updateKnowledgeDocument,
    UPDATED_MESSAGE,
  );
}

/**
 * The same, for a question and its answer.
 *
 * Separate from the text action rather than one action branching on which fields arrived. The
 * two shapes validate against different halves of the discriminated union, and a single action
 * inferring the type from the presence of a `question` field would treat a text document whose
 * form failed to send its content as a malformed Q&A — reporting the wrong missing field.
 */
export async function saveFaqKnowledgeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const documentId = formData.get('documentId');

  if (documentId === null || documentId === '') {
    return perform(
      createKnowledgeDocumentSchema.safeParse(faqFieldsFrom(formData)),
      createKnowledgeDocument,
      SAVED_MESSAGE,
    );
  }

  return perform(
    updateKnowledgeDocumentSchema.safeParse({ ...faqFieldsFrom(formData), documentId }),
    updateKnowledgeDocument,
    UPDATED_MESSAGE,
  );
}

/** A reference the two id-only actions below post. `?? undefined` for the reason on
 *  `textFieldsFrom`: a missing field is missing, not empty. */
function refFrom(formData: FormData) {
  return { documentId: formData.get('documentId') ?? undefined };
}

export async function deleteKnowledgeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return perform(
    knowledgeDocumentRefSchema.safeParse(refFrom(formData)),
    deleteKnowledgeDocument,
    'Removed. Your assistant will stop using it.',
  );
}

export async function retryKnowledgeAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return perform(
    knowledgeDocumentRefSchema.safeParse(refFrom(formData)),
    retryKnowledgeDocument,
    'Trying again. This usually takes a moment.',
  );
}

/**
 * Loads one document's text so the edit dialog can open filled in.
 *
 * A read, not a mutation, so it returns the document instead of a `FormState` and revalidates
 * nothing. It exists as an action rather than as a prop from the page because the list
 * projection carries no bodies on purpose — sending every document's full text to the browser
 * to prefill the one dialog that might be opened is the cost this avoids.
 *
 * The id is validated here even though the service scopes by workspace anyway: this argument
 * arrives from a browser, and `unknown` is what a server action's first parameter honestly is.
 */
export async function loadKnowledgeSourceAction(rawDocumentId: unknown): Promise<
  | { readonly ok: true; readonly document: KnowledgeDocumentSource }
  | { readonly ok: false; readonly message: string }
> {
  const parsed = knowledgeDocumentId.safeParse(rawDocumentId);
  if (!parsed.success) {
    return { ok: false, message: 'That knowledge could not be opened. Refresh and try again.' };
  }

  try {
    const context = await requireTenantContext();
    return { ok: true, document: await getKnowledgeDocumentSource(context, parsed.data) };
  } catch (error) {
    // `formErrorFrom` for the logging and the safe-message translation, not for its shape —
    // an unexposed error must not arrive here as a provider detail any more than it may on a
    // form.
    const safe = formErrorFrom(error);
    return {
      ok: false,
      message: safe.message ?? 'That knowledge could not be opened. Refresh and try again.',
    };
  }
}
