import { BookOpen, FileText, Globe, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

/**
 * The knowledge screen, in miniature.
 *
 * Three things the shop owner has taught the assistant and one still being read. The
 * "reading" row is the honest detail: a PDF is chunked and embedded in the background, so
 * a screenshot that showed everything instantly ready would be selling a different product.
 */

const SOURCES = [
  {
    icon: BookOpen,
    name: 'Delivery & payment FAQ',
    detail: '8 answers',
    status: 'ready',
  },
  {
    icon: FileText,
    name: 'Size guide.pdf',
    detail: '12 sections',
    status: 'ready',
  },
  {
    icon: Globe,
    name: 'akmalfashion.pk/shipping',
    detail: 'Page text',
    status: 'ready',
  },
  {
    icon: FileText,
    name: 'Exchange policy.docx',
    detail: 'Being read',
    status: 'working',
  },
] as const;

export function KnowledgeMock() {
  return (
    <div className="bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">What your AI knows</p>
        <span className="text-2xs text-muted-foreground">4 sources</span>
      </div>

      <ul className="mt-3 flex flex-col">
        {SOURCES.map((source) => (
          <li
            key={source.name}
            className="flex items-center gap-2.5 border-t border-border py-2.5 first:border-t-0 first:pt-0"
          >
            <source.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{source.name}</span>
            <span className="hidden shrink-0 text-2xs text-muted-foreground sm:inline">
              {source.detail}
            </span>
            {source.status === 'ready' ? (
              <Badge variant="success" size="sm" dot className="shrink-0">
                In use
              </Badge>
            ) : (
              <Badge variant="muted" size="sm" className="shrink-0 gap-1">
                <Loader2 aria-hidden />
                Reading
              </Badge>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
        Answers are built from these and nothing else. Remove a source and the assistant stops
        using it.
      </p>
    </div>
  );
}
