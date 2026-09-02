import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Table primitives for the product's operational screens.
 *
 * There was no table primitive before, so every list — products, orders, contacts, team
 * members — invented its own row markup. That is why those screens did not read as one
 * product even though they are all the same shape.
 *
 * Rows are separated by a hairline rather than by zebra striping. Striping is a workaround
 * for rows that are too tall to track across; at this density the rule is enough, and it
 * leaves the background free to mean something — hover, or needs attention.
 *
 * Every `Table` takes an `aria-label`. A screen reader can list the tables on a page, and
 * seven entries all called "table" is no use; the label says which list this is.
 *
 * There is no sticky heading row, and the reason is worth recording so it is not added back
 * as an obvious improvement. `TableContainer` scrolls horizontally so a wide table never
 * widens the page, and CSS will not let an element scroll on one axis and overflow visibly on
 * the other — `overflow-x: auto` forces `overflow-y` to compute to `auto` too. That makes the
 * container the scrollport for anything sticky inside it, so `sticky top-0` would pin the
 * heading to a box that never scrolls vertically and do nothing at all. It would work only if
 * a table were given a fixed height, and none is: these lists are paginated, so the page
 * scroll is short and the heading is never far away.
 */

/** Scroll container. A table must never widen the page — it scrolls inside its own frame. */
const TableContainer = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('w-full overflow-x-auto overscroll-x-contain scrollbar-thin', className)}
      {...props}
    />
  ),
);
TableContainer.displayName = 'TableContainer';

export type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  /**
   * Names the list for assistive technology — "Orders", "Products in this catalogue".
   *
   * Required rather than optional, because a table with no accessible name is only
   * discoverable as "table" and that is the sort of gap that is never noticed later. A
   * `<caption>` would be the other way to supply it, but every table here already sits under
   * a visible card title, and a second visible title is worse than an attribute.
   */
  'aria-label': string;
};

const Table = forwardRef<HTMLTableElement, TableProps>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full border-separate border-spacing-0 text-sm', className)}
    {...props}
  />
));
Table.displayName = 'Table';

export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>;

const TableHeader = forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, ...props }, ref) => <thead ref={ref} className={className} {...props} />,
);
TableHeader.displayName = 'TableHeader';

const TableBody = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    // The last row draws no rule under itself. Whatever frames the table — a card edge, a
    // footer's own top border — already closes it, and a rule plus a border reads as a
    // two-pixel seam at the one place a reader notices alignment most.
    className={cn('[&>tr:last-child>td]:border-b-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement> & {
  /** Adds hover feedback. Only set this when the row is actually clickable. */
  interactive?: boolean;
};

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, interactive, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'transition-colors duration-instant ease-out',
        // `surface-sunken`, not `accent`: accent is the hover surface for controls — buttons,
        // menu items — and a row is a surface. This is the same hover the conversation list
        // uses, so a clickable row feels the same everywhere in the product.
        interactive && 'cursor-pointer hover:bg-surface-sunken',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

/**
 * A column heading. `numeric` right-aligns it to sit over the figures in its column —
 * a right-aligned number under a left-aligned label is a small, constant irritation.
 */
export type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean;
};

const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, numeric, ...props }, ref) => (
    <th
      ref={ref}
      scope="col"
      className={cn(
        'eyebrow whitespace-nowrap border-b border-border bg-surface-sunken px-4 py-2.5 text-left align-middle',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
  /** Right-aligns and sets tabular figures, so a column of money lines up. */
  numeric?: boolean;
};

const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'border-b border-border px-4 py-3 align-middle',
        numeric && 'text-right font-mono text-sm tabular-nums',
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';

export { TableContainer, Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
