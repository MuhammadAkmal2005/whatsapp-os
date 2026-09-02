import { ArrowRight, CornerUpLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { preserveParams, withParams, type SearchParams } from '@/lib/search-params';

/**
 * The footer of a cursor-paginated list.
 *
 * Products, orders and customers each had a private copy of this component. They were the
 * same twenty lines three times over, and the copies had already drifted in which filter
 * keys they carried forward.
 *
 * There is no "previous page" and that is deliberate, not missing. A cursor identifies a
 * position in a list that is still being written to, so walking backwards from one is not
 * reliably the page you came from. The browser's back button is, and it is the control
 * people reach for anyway.
 *
 * It sits inside the list's own card as a footer rather than floating below it, because
 * paging is an action on the table above it and belongs attached to it.
 */
export type CursorPaginationProps = {
  /** The route the list lives on, without a query string — `/products`. */
  basePath: string;
  /** The page's resolved query parameters, so the reader's filters survive the jump. */
  params: SearchParams;
  /** Filter keys to carry across. Do not list `cursor`; it is handled here. */
  preserve: readonly string[];
  /** The cursor for the next page, or null when this is the last one. */
  cursor: string | null;
  /**
   * Whether the reader is past the first page. Taken from the *validated* cursor rather
   * than read from the URL here, so a rejected cursor — which leaves the page showing the
   * first results — does not offer to send them "back to the start" they are already on.
   */
  isPastFirstPage: boolean;
  /** What the list holds, lower case and plural: "products", "orders", "customers". */
  itemsLabel: string;
};

export function CursorPagination({
  basePath,
  params,
  preserve,
  cursor,
  isPastFirstPage,
  itemsLabel,
}: CursorPaginationProps) {
  // A single-page list needs no footer at all, and deciding that here means no page has to
  // repeat the condition beside the component.
  if (!cursor && !isPastFirstPage) return null;

  const preserved = preserveParams(params, preserve);
  const nextParams = new URLSearchParams(preserved.toString());
  if (cursor) nextParams.set('cursor', cursor);

  return (
    <CardFooter className="justify-between">
      {isPastFirstPage ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={withParams(basePath, preserved)}>
            <CornerUpLeft aria-hidden />
            Back to the start
          </Link>
        </Button>
      ) : (
        // Holds the trailing button on the right at every width without a justify switch.
        <span aria-hidden />
      )}

      {cursor ? (
        <Button asChild variant="outline" size="sm">
          <Link href={withParams(basePath, nextParams)}>
            Show more {itemsLabel}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      ) : null}
    </CardFooter>
  );
}
