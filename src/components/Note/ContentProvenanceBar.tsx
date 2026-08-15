import { getContentProvenanceFromEvent } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'

function sourceHostname(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, '')
  } catch {
    return source
  }
}

/**
 * Subtle source (`s` / `source`) + `i` identifier row for wiki articles and publications.
 * Placed under the title for interlinking and copyright attribution.
 */
export default function ContentProvenanceBar({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { source, identifiers } = useMemo(() => getContentProvenanceFromEvent(event), [event])
  if (!source && identifiers.length === 0) return null

  return (
    <div
      className={cn(
        'not-prose mb-4 flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground',
        className
      )}
    >
      {source ? (
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-primary/80 hover:text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{sourceHostname(source)}</span>
        </a>
      ) : null}
      {identifiers.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {identifiers.map((identifier) =>
            identifier.url ? (
              <a
                key={identifier.value}
                href={identifier.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-[11px] text-primary/90 hover:bg-accent"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="size-2.5 shrink-0" aria-hidden />
                <span className="truncate">{identifier.label}</span>
              </a>
            ) : (
              <span
                key={identifier.value}
                className="inline-flex max-w-full items-center rounded-full bg-muted/80 px-2 py-0.5 text-[11px]"
              >
                <span className="truncate">{identifier.label}</span>
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}
