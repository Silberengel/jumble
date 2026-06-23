import PublicationCard from '@/components/Note/PublicationCard'
import { Skeleton } from '@/components/ui/skeleton'
import type { LibraryPublicationEntry } from '@/lib/library-publication-index'
import { eventTagAddress } from '@/lib/publication-index'
import { isBooklistNip32Label } from '@/lib/nip32-label'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { BookOpen, Bookmark, Highlighter, MessageSquare, Pin, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function LabelBadgeIcon({ name }: { name: string }) {
  if (isBooklistNip32Label(name)) {
    return <BookOpen className="size-3" aria-hidden />
  }
  return <Tag className="size-3" aria-hidden />
}

function EngagementBadges({ entry }: { entry: LibraryPublicationEntry }) {
  const { t } = useTranslation()
  const otherLabels = entry.labelNames.filter((name) => !isBooklistNip32Label(name))
  if (
    !entry.hasBooklistLabel &&
    otherLabels.length === 0 &&
    !entry.hasLabel &&
    !entry.hasComment &&
    !entry.hasHighlight &&
    !entry.hasBookmark &&
    !entry.hasPin
  ) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {entry.hasBooklistLabel ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            entry.hasMyBooklistLabel
              ? 'bg-green-500/15 text-green-700 ring-1 ring-green-600/30 dark:bg-green-500/20 dark:text-green-400 dark:ring-green-500/40'
              : 'bg-muted text-muted-foreground'
          )}
          title={
            entry.hasMyBooklistLabel
              ? t('Library badge my booklist')
              : t('Library badge booklist')
          }
        >
          <BookOpen className="size-3" aria-hidden />
          <span className="sr-only">
            {entry.hasMyBooklistLabel
              ? t('Library badge my booklist')
              : t('Library badge booklist')}
          </span>
        </span>
      ) : null}
      {entry.hasLabel &&
        (otherLabels.length > 0 ? (
          otherLabels.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <LabelBadgeIcon name={name} />
              {name}
            </span>
          ))
        ) : (
          !entry.hasBooklistLabel ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Tag className="size-3" aria-hidden />
              {t('Library badge label')}
            </span>
          ) : null
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
      {entry.hasBookmark && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Bookmark className="size-3" aria-hidden />
          {t('Library badge bookmark')}
        </span>
      )}
      {entry.hasPin && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Pin className="size-3" aria-hidden />
          {t('Library badge pin')}
        </span>
      )}
    </div>
  )
}

export default function LibraryPublicationGrid({
  entries,
  loading,
  searchPending,
  emptyMessage
}: {
  entries: LibraryPublicationEntry[]
  loading?: boolean
  /** More results may still arrive — show a small tail skeleton without hiding current rows. */
  searchPending?: boolean
  emptyMessage?: string
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const gridCols = isSmallScreen ? 'grid-cols-1' : 'grid-cols-2'

  if (loading) {
    return (
      <div className={cn('grid gap-4', gridCols)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (entries.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        {emptyMessage ?? t('Library empty')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={cn('grid gap-4', gridCols)}>
        {entries.map((entry) => (
          <div
            key={eventTagAddress(entry.event) ?? entry.event.id}
            className={cn(
              'flex min-w-0 flex-col rounded-lg border border-border bg-card shadow-sm overflow-hidden'
            )}
          >
            <PublicationCard
              event={entry.event}
              presentation="library"
              className="border-0 shadow-none rounded-none"
              contentSearchMatch={entry.contentSearchMatch}
            />
            <EngagementBadges entry={entry} />
          </div>
        ))}
        {searchPending
          ? Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={`pending-${i}`} className="h-48 w-full rounded-lg" />
            ))
          : null}
      </div>
    </div>
  )
}
