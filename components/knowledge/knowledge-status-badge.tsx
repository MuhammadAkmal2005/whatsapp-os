/**
 * What a piece of knowledge's processing state looks like.
 *
 * No `'use client'`: a pure function of its props, so it renders on the server and costs the
 * browser nothing.
 *
 * The colours carry the meaning a shop owner needs at a glance down the column, and only
 * that. `info` for work in progress rather than `warning`, because nothing is wrong while a
 * document is being read — a yellow chip on every freshly saved document would teach the
 * reader that yellow means "normal", and then the real warnings stop registering.
 *
 * `dot` on every variant so the four states are distinguishable without relying on hue,
 * which matters both for colour blindness and for the moment a row is glanced at rather than
 * read.
 */

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatus } from '@/server/validation/knowledge';

const STATUS_VARIANT: Record<KnowledgeStatus, BadgeProps['variant']> = {
  PENDING: 'info',
  PROCESSING: 'info',
  READY: 'success',
  FAILED: 'danger',
};

export function KnowledgeStatusBadge({ status }: { status: KnowledgeStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} dot>
      {KNOWLEDGE_STATUS_LABELS[status]}
    </Badge>
  );
}
