'use server';

/**
 * Contact server actions.
 *
 * Thin adapters: parse, delegate, translate. Every one resolves its own tenant
 * context rather than accepting a workspace id, so the scope comes from the
 * session cookie and a crafted form post cannot redirect a customer edit into
 * another business.
 *
 * None of these check permissions. `requirePermission` runs inside the service,
 * which is the one place every entry point shares — a check here as well would
 * read as thorough while creating a second place for the rule to drift.
 *
 * `formData.get` returns `FormDataEntryValue | null`, and Zod is what turns that
 * into a typed value. Passing the raw entry straight in is deliberate: a `File`
 * posted where a string was expected fails validation rather than being coerced
 * into the string `"[object File]"`.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { type FormState } from '@/lib/form-state';
import { formErrorFrom, validationFormState } from '@/server/actions/action-helpers';
import { getRequestMeta } from '@/server/http/request-meta';
import {
  addContactNote,
  assignContact,
  createContact,
  deleteContact,
  setContactStatus,
  setLeadStage,
  updateContact,
} from '@/server/services/contact/contact.service';
import { requireTenantContext } from '@/server/tenancy/resolve';
import {
  addContactNoteSchema,
  assignContactSchema,
  createContactSchema,
  deleteContactSchema,
  setContactStatusSchema,
  setLeadStageSchema,
  updateContactSchema,
} from '@/server/validation/contact';

const CONTACTS_PATH = '/contacts';

/** The editable fields, read from a form in one place so the create and update
 *  actions cannot drift apart on which fields they accept. */
function contactFieldsFrom(formData: FormData) {
  return {
    name: formData.get('name') ?? undefined,
    email: formData.get('email') ?? undefined,
    status: formData.get('status') ?? undefined,
    leadStage: formData.get('leadStage') ?? undefined,
    source: formData.get('source') ?? undefined,
    language: formData.get('language') ?? undefined,
    assignedToMemberId: formData.get('assignedToMemberId') ?? undefined,
    city: formData.get('city') ?? undefined,
    addressLine1: formData.get('addressLine1') ?? undefined,
    addressLine2: formData.get('addressLine2') ?? undefined,
    postalCode: formData.get('postalCode') ?? undefined,
  };
}

/**
 * Creates a customer and goes straight to their profile.
 *
 * The redirect is outside the try block on purpose. Next.js implements `redirect`
 * by throwing, so calling it inside would be caught by the error handler below and
 * reported to the person as a failed save — of a customer that was in fact saved.
 */
export async function createContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createContactSchema.safeParse({
    phone: formData.get('phone'),
    ...contactFieldsFrom(formData),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  let contactId: string;
  try {
    const ctx = await requireTenantContext();
    const contact = await createContact(ctx, parsed.data, await getRequestMeta());
    contactId = contact.id;
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(CONTACTS_PATH);
  redirect(`${CONTACTS_PATH}/${contactId}`);
}

export async function updateContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateContactSchema.safeParse({
    contactId: formData.get('contactId'),
    ...contactFieldsFrom(formData),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await updateContact(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(CONTACTS_PATH);
  revalidatePath(`${CONTACTS_PATH}/${parsed.data.contactId}`);
  return { status: 'success', message: 'Customer details saved.' };
}

export async function setContactStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setContactStatusSchema.safeParse({
    contactId: formData.get('contactId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await setContactStatus(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(CONTACTS_PATH);
  revalidatePath(`${CONTACTS_PATH}/${parsed.data.contactId}`);
  return { status: 'success', message: 'Status updated.' };
}

export async function setLeadStageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setLeadStageSchema.safeParse({
    contactId: formData.get('contactId'),
    leadStage: formData.get('leadStage'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await setLeadStage(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(CONTACTS_PATH);
  revalidatePath(`${CONTACTS_PATH}/${parsed.data.contactId}`);
  return { status: 'success', message: 'Stage updated.' };
}

export async function assignContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignContactSchema.safeParse({
    contactId: formData.get('contactId'),
    assignedToMemberId: formData.get('assignedToMemberId') ?? undefined,
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await assignContact(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(CONTACTS_PATH);
  revalidatePath(`${CONTACTS_PATH}/${parsed.data.contactId}`);
  return {
    status: 'success',
    message: parsed.data.assignedToMemberId ? 'Customer assigned.' : 'Assignment cleared.',
  };
}

export async function addContactNoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = addContactNoteSchema.safeParse({
    contactId: formData.get('contactId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await addContactNote(ctx, parsed.data, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(`${CONTACTS_PATH}/${parsed.data.contactId}`);
  return { status: 'success', message: 'Note added.' };
}

/** Redirects back to the list, because the profile the person was on no longer
 *  has anything to show. Same reason the redirect sits outside the try block. */
export async function deleteContactAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteContactSchema.safeParse({ contactId: formData.get('contactId') });
  if (!parsed.success) return validationFormState(parsed.error);

  try {
    const ctx = await requireTenantContext();
    await deleteContact(ctx, parsed.data.contactId, await getRequestMeta());
  } catch (error) {
    return formErrorFrom(error);
  }

  revalidatePath(CONTACTS_PATH);
  redirect(CONTACTS_PATH);
}
