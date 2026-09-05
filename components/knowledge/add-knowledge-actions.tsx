'use client';

/**
 * The two ways to add something, and the dialogs they open.
 *
 * Two buttons rather than one with a menu behind it. Text and Q&A are not variations of one
 * action — they are the two shapes knowledge comes in, and a shop owner deciding which to use
 * is better served by seeing both than by discovering the second inside a dropdown.
 *
 * Rendered in the page header and, on a business with nothing saved yet, inside the empty
 * state. Two instances is intentional: each holds its own dialog state, and the empty state's
 * copy has already made the case for pressing one of them.
 */

import { MessageSquarePlus, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { FaqDocumentDialog } from '@/components/knowledge/faq-document-dialog';
import { TextDocumentDialog } from '@/components/knowledge/text-document-dialog';
import { Button } from '@/components/ui/button';

type OpenDialog = 'none' | 'text' | 'faq';

export function AddKnowledgeActions() {
  const [dialog, setDialog] = useState<OpenDialog>('none');

  // Stable, because `useCloseOnSuccess` depends on it.
  const close = useCallback(() => setDialog('none'), []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialog('text')}>
          <Plus aria-hidden />
          Add text
        </Button>
        <Button variant="outline" onClick={() => setDialog('faq')}>
          <MessageSquarePlus aria-hidden />
          Add Q&amp;A
        </Button>
      </div>

      {dialog === 'text' ? <TextDocumentDialog onClose={close} /> : null}
      {dialog === 'faq' ? <FaqDocumentDialog onClose={close} /> : null}
    </>
  );
}
