/**
 * The list of everything a business has taught its assistant.
 *
 * A server component. Nothing here needs the browser: the only interactive parts are the row
 * menu and the retry button, which are their own client islands, so a page of fifty documents
 * ships fifty rows of HTML and no list-rendering JavaScript.
 *
 * `now` arrives as a prop rather than being read per row. Every relative time on the page then
 * describes the same instant, which is both correct — two rows saved a second apart should not
 * disagree about what "just now" means — and stable, since a value read during render is a
 * value that differs between the server's HTML and the browser's first pass.
 *
 * Three columns fold away below `md`. They fold *into* the first cell rather than vanishing:
 * a phone showing only a title and a status badge hides the two facts most likely to explain
 * the badge.
 */

import { KnowledgeRowActions } from '@/components/knowledge/knowledge-row-actions';
import { KnowledgeStatusBadge } from '@/components/knowledge/knowledge-status-badge';
import { RetryKnowledgeButton } from '@/components/knowledge/retry-knowledge-button';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KNOWLEDGE_STALLED_AFTER_MS } from '@/config/constants';
import { formatRelativeTimeCompact } from '@/lib/datetime';
import type { KnowledgeDocumentSummary } from '@/server/services/knowledge/knowledge.service';
import { isKnowledgeInFlight, knowledgeTypeLabel } from '@/server/validation/knowledge';

/** "Sections" is the word for the pieces a document is read in. A shop owner has no reason to
 *  learn ours, and the count is worth showing because it is the visible proof that something
 *  was read at all. */
function sectionsSummary(count: number): string {
  if (count === 0) return 'Not read yet';
  return count === 1 ? '1 section' : `${count} sections`;
}

export function KnowledgeTable({
  documents,
  now,
}: {
  documents: readonly KnowledgeDocumentSummary[];
  now: Date;
}) {
  return (
    <TableContainer>
      <Table aria-label="Knowledge">
        <TableHeader>
          <TableRow>
            <TableHead>Knowledge</TableHead>
            <TableHead className="hidden md:table-cell">Kind</TableHead>
            <TableHead numeric className="hidden md:table-cell">
              Sections
            </TableHead>
            <TableHead className="hidden lg:table-cell">Updated</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-px">
              <span className="sr-only">Edit or remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {documents.map((row) => (
            <KnowledgeRow key={row.id} row={row} now={now} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function KnowledgeRow({ row, now }: { row: KnowledgeDocumentSummary; now: Date }) {
  const inFlight = isKnowledgeInFlight(row.status);
  const kind = knowledgeTypeLabel(row.type);
  const sections = sectionsSummary(row.chunkCount);
  const updated = formatRelativeTimeCompact(row.updatedAt, now);

  // A worker that claimed this and died leaves a row that says "Processing…" for ever. Past
  // the queue's own lock timeout it is no longer waiting for anything, so the row stops
  // pretending and offers the way out. `startedAt` is the claim; a PENDING row has none yet,
  // and `updatedAt` is when it was queued.
  const waitingSince = row.startedAt ?? row.updatedAt;
  const stalled = inFlight && now.getTime() - waitingSince.getTime() > KNOWLEDGE_STALLED_AFTER_MS;

  // Editing is offered only once the document has settled. An edit mid-processing is handled
  // correctly by the ingestion — it discards the older attempt — but offering it invites a
  // person to change something while the previous version is still being read, and the row
  // they are looking at cannot show them which version won.
  const canEdit = row.can.update && !inFlight;
  const canRetry = row.can.retry && (row.status === 'FAILED' || stalled);

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium text-foreground">{row.title}</span>

          <span className="text-xs text-muted-foreground md:hidden">
            {kind} · {sections} · {updated}
          </span>

          {row.status === 'FAILED' && row.errorMessage ? (
            <span className="max-w-prose text-xs text-destructive">{row.errorMessage}</span>
          ) : null}

          {stalled ? (
            <span className="max-w-prose text-xs text-muted-foreground">
              This is taking longer than it should. Try again to start it over.
            </span>
          ) : null}

          {canRetry ? <RetryKnowledgeButton documentId={row.id} title={row.title} /> : null}
        </div>
      </TableCell>

      <TableCell className="hidden md:table-cell">{kind}</TableCell>

      <TableCell numeric className="hidden whitespace-nowrap md:table-cell">
        {sections}
      </TableCell>

      <TableCell className="hidden whitespace-nowrap lg:table-cell">{updated}</TableCell>

      <TableCell>
        <KnowledgeStatusBadge status={row.status} />
      </TableCell>

      <TableCell>
        <KnowledgeRowActions
          documentId={row.id}
          title={row.title}
          canEdit={canEdit}
          canDelete={row.can.delete}
        />
      </TableCell>
    </TableRow>
  );
}
