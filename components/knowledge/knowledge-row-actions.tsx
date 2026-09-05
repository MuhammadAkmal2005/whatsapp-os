'use client';

/**
 * The per-row menu: edit what a document says, or remove it.
 *
 * The menu items only set state; the dialogs are siblings of the dropdown, not children of
 * it. Radix unmounts a dropdown's content on close, so a form living inside would be torn
 * down as the menu dismisses.
 *
 * Editing fetches the source rather than receiving it. The list projection carries no bodies
 * on purpose — a page of fifty policies would otherwise send every word of all fifty to the
 * browser to prefill the one dialog that might be opened. The cost is a moment's wait on the
 * first click, which the trigger shows.
 *
 * A fetch that fails says so in a dialog instead of doing nothing. It can genuinely fail: the
 * row may have been deleted by a colleague a moment ago, or be one of the older kinds this
 * screen cannot edit. Silence would leave the person pressing a menu item that appears broken.
 */

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';

import { DeleteKnowledgeDialog } from '@/components/knowledge/delete-knowledge-dialog';
import { FaqDocumentDialog } from '@/components/knowledge/faq-document-dialog';
import { TextDocumentDialog } from '@/components/knowledge/text-document-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { loadKnowledgeSourceAction } from '@/server/actions/knowledge.actions';
import type { KnowledgeDocumentSource } from '@/server/validation/knowledge';

type RowDialog =
  | { readonly kind: 'none' }
  | { readonly kind: 'edit'; readonly source: KnowledgeDocumentSource }
  | { readonly kind: 'delete' }
  | { readonly kind: 'problem'; readonly message: string };

export function KnowledgeRowActions({
  documentId,
  title,
  canEdit,
  canDelete,
}: {
  documentId: string;
  title: string;
  /** Decided on the server: the permission, and whether the document is settled enough to
   *  edit. Editing one mid-processing would race its own re-processing. */
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [dialog, setDialog] = useState<RowDialog>({ kind: 'none' });
  const [isLoading, startLoading] = useTransition();

  // Stable, because the dialogs' close-on-success effect depends on it.
  const close = useCallback(() => setDialog({ kind: 'none' }), []);

  const openEdit = useCallback(() => {
    startLoading(async () => {
      const result = await loadKnowledgeSourceAction(documentId);
      setDialog(
        result.ok
          ? { kind: 'edit', source: result.document }
          : { kind: 'problem', message: result.message },
      );
    });
  }, [documentId]);

  // No permission to change anything means no column content. An empty menu that opens to
  // nothing is worse than no menu.
  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex items-center justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            isLoading={isLoading}
            aria-label={`More actions for ${title}`}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {canEdit ? (
            <DropdownMenuItem onSelect={openEdit}>
              <Pencil aria-hidden />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canDelete ? (
            <DropdownMenuItem destructive onSelect={() => setDialog({ kind: 'delete' })}>
              <Trash2 aria-hidden />
              Remove
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog.kind === 'edit' && dialog.source.type === 'TEXT' ? (
        <TextDocumentDialog existing={dialog.source} onClose={close} />
      ) : null}

      {dialog.kind === 'edit' && dialog.source.type === 'FAQ' ? (
        <FaqDocumentDialog existing={dialog.source} onClose={close} />
      ) : null}

      {dialog.kind === 'delete' ? (
        <DeleteKnowledgeDialog documentId={documentId} title={title} onClose={close} />
      ) : null}

      {dialog.kind === 'problem' ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) close();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>This could not be opened</DialogTitle>
              <DialogDescription>{dialog.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
