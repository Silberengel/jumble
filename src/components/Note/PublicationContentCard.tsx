import Collapsible from '@/components/Collapsible'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPageOptional } from '@/PageManager'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AsciidocArticle from './LazyAsciidocArticle'

function getTagValue(event: Event, tagName: string): string {
  return event.tags.find((tag) => tag[0]?.toLowerCase() === tagName.toLowerCase())?.[1]?.trim() || ''
}

function formatCitationDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString()
    }
  } catch {
    // fall through
  }
  return dateStr
}

/**
 * Surface for NKBIP-01 publication content (kind 30041): compact citation-style header and rendered
 * body — not a cover-image promo card. Embed variant collapses long sections; full variant shows all content.
 */
export default function PublicationContentCard({
  event,
  className,
  interactive = true,
  variant = 'embed'
}: {
  event: Event
  className?: string
  /** When false (note page), header is not a navigation target. */
  interactive?: boolean
  variant?: 'embed' | 'full'
}) {
  const { t } = useTranslation()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => {
    window.location.href = url
  })
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])

  const headerMeta = useMemo(() => {
    const author = getTagValue(event, 'author')
    const publishedBy = getTagValue(event, 'published_by')
    const publishedOn = formatCitationDate(getTagValue(event, 'published_on'))
    const source = getTagValue(event, 'source')

    const parts: string[] = []
    if (author) parts.push(author)
    else if (publishedBy) parts.push(publishedBy)
    if (publishedOn) parts.push(publishedOn)
    else if (source) {
      try {
        parts.push(new URL(source).hostname.replace(/^www\./, ''))
      } catch {
        parts.push(source)
      }
    }

    return parts.join(' · ')
  }, [event])

  const displayTitle = metadata.title?.trim() || t('Publication section')
  const hasBody = Boolean(event.content?.trim())
  const isFull = variant === 'full'

  const handleOpenNote = (e: React.MouseEvent) => {
    if (!interactive) return
    e.stopPropagation()
    push(toNote(event))
  }

  const header = (
    <div
      className={cn(
        isFull ? 'space-y-0.5' : 'border-b border-border/60 px-3 py-2',
        !isFull && interactive && 'cursor-pointer hover:bg-muted/40'
      )}
      onClick={!isFull && interactive ? handleOpenNote : undefined}
    >
      <div
        className={cn(
          'font-semibold leading-snug break-words',
          isFull ? 'text-xl sm:text-2xl' : 'text-sm'
        )}
      >
        {displayTitle}
      </div>
      {headerMeta ? (
        <div className={cn('text-muted-foreground break-words', isFull ? 'text-sm' : 'text-xs')}>
          {headerMeta}
        </div>
      ) : null}
    </div>
  )

  const body = hasBody ? (
    <div
      className={cn(
        isFull ? 'mt-3 min-w-0' : 'border-l-2 border-primary/50 pl-3 text-sm',
        !isFull && 'px-3 py-2'
      )}
      onClick={!isFull ? (e) => e.stopPropagation() : undefined}
    >
      <AsciidocArticle
        event={event}
        contentOnly
        className={cn(isFull ? 'prose prose-zinc max-w-none dark:prose-invert' : 'prose-sm max-w-none')}
      />
    </div>
  ) : metadata.summary?.trim() ? (
    <p
      className={cn(
        'text-muted-foreground break-words',
        isFull ? 'mt-3 text-base' : 'px-3 py-2 text-sm'
      )}
    >
      {metadata.summary}
    </p>
  ) : null

  if (isFull) {
    return (
      <div className={cn('min-w-0', className)}>
        {header}
        {body}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border/80 bg-muted/20',
        !interactive && 'pointer-events-none',
        className
      )}
    >
      {header}
      {hasBody ? (
        <Collapsible threshold={280} collapsedHeight={220}>
          {body}
        </Collapsible>
      ) : (
        body
      )}
    </div>
  )
}
