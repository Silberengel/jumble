import { getContentProvenanceFromEvent } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'

/**
 * Subtle source (`s` / `source`) + `i` identifier row for wiki articles and publications.
 * Single deduped list: source URL first, then other identifiers that are not the same page.
 */
export default function ContentProvenanceBar({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const links = useMemo(() => getContentProvenanceFromEvent(event), [event])
  if (links.length === 0) return null

  return (
    <div
      className={cn(
        'not-prose mb-4 flex min-w-0 flex-wrap gap-1.5 text-xs text-muted-foreground',
        className
      )}
    >
      {links.map((link) =>
        link.href ? (
          <a
            key={`${link.href}:${link.label}`}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-[11px] text-primary/90 hover:bg-accent hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="size-2.5 shrink-0" aria-hidden />
            <span className="truncate">{link.label}</span>
          </a>
        ) : (
          <span
            key={`label:${link.label}`}
            className="inline-flex max-w-full items-center rounded-full bg-muted/80 px-2 py-0.5 text-[11px]"
          >
            <span className="truncate">{link.label}</span>
          </span>
        )
      )}
    </div>
  )
}
