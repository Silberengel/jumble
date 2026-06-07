import PublicationCard from '@/components/Note/PublicationCard'
import { Skeleton } from '@/components/ui/skeleton'
import type { LibraryPublicationEntry } from '@/lib/library-publication-index'
import { cn } from '@/lib/utils'
import { Highlighter, MessageSquare, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function EngagementBadges({ entry }: { entry: LibraryPublicationEntry }) {
  const { t } = useTranslation()
  if (!entry.hasLabel && !entry.hasComment && !entry.hasHighlight) return null

  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {entry.hasLabel &&
        (entry.labelNames.length > 0 ? (
          entry.labelNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <Tag className="size-3" aria-hidden />
              {name}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <Tag className="size-3" aria-hidden />
            {t('Library badge label')}
          </span>
        ))}
      {entry.hasComment && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <MessageSquare className="size-3" aria-hidden />
          {t('Library badge comment')}
        </span>
      )}
      {entry.hasHighlight && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Highlighter className="size-3" aria-hidden />
          {t('Library badge highlight')}
        </span>
      )}
    </div>
  )
}

export default function LibraryPublicationGrid({
  entries,
  loading,
  emptyMessage
}: {
  entries: LibraryPublicationEntry[]
  loading?: boolean
  emptyMessage?: string
}) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        {emptyMessage ?? t('Library empty')}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <div
          key={entry.event.id}
          className={cn(
            'flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-sm overflow-hidden'
          )}
        >
          <PublicationCard event={entry.event} presentation="library" className="border-0 shadow-none rounded-none" />
          <EngagementBadges entry={entry} />
        </div>
      ))}
    </div>
  )
}
