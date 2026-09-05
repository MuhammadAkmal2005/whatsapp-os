'use client';

import { useEffect } from 'react';

import type { FormState } from '@/lib/form-state';

/**
 * Closes a dialog once its action succeeds.
 *
 * Shared by the three knowledge dialogs because all three want the same thing and the
 * failure mode of getting it wrong is identical: a panel left sitting over the row it just
 * changed, so the person has to dismiss a form to see whether their edit landed.
 *
 * `onClose` is expected to be stable — a `useCallback` in the parent — because it is a
 * dependency here. An inline arrow would make this effect run on every parent render, which
 * is harmless only by luck.
 */
export function useCloseOnSuccess(state: FormState, onClose: () => void): void {
  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);
}
