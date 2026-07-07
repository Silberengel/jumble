import { ExtendedKind } from '@/constants'
import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import {
  getLongFormArticleMetadataFromEvent,
  getPublicationIndexMetadataFromEvent
} from '@/lib/event-metadata'
import { persistLibraryPublicationForReading, type LibraryPublicationContentSearchMatch } from '@/lib/library-publication-index'
import { setLibraryPublicationReadingIntent } from '@/lib/library-publication-reading-intent'
import { markPublicationReadingStarted } from '@/lib/library-publication-reading-session'
import { eventTagAddress } from '@/lib/publication-index'
import { toNote, toNoteList } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPageOptional, useSmartNoteNavigationOptional } from '@/PageManager'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ArticleHeroCard from './ArticleHeroCard'
import PublicationIndexMetadata from './PublicationIndexMetadata'

export default function PublicationCard({
  event,
  className,
  disableNavigation = false,
  /** Library grid: stacked cover on top, compact cover height. */
  presentation = 'default',
  contentSearchMatch
}: {
  event: Event
  className?: string
  /** When true (e.g. full note view), card is display-only; no navigate-to-note on click. */
  disableNavigation?: boolean
  presentation?: 'default' | 'library'
  contentSearchMatch?: LibraryPublicationContentSearchMatch
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const indexMetadata = useMemo(
    () => (event.kind === ExtendedKind.PUBLICATION ? getPublicationIndexMetadataFromEvent(event) : null),
    [event]
  )
  const bodyBlurb = useMemo(
    () => cardEventBodyBlurb(event.content, { markup: 'asciidoc' }),
    [event.content]
  )
  const isPublicationIndex = event.kind === ExtendedKind.PUBLICATION

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disableNavigation) return
    persistLibraryPublicationForReading(event)
    if (presentation === 'library') {
      markPublicationReadingStarted(event)
    }
    if (contentSearchMatch) {
      setLibraryPublicationReadingIntent({
        rootEventId: event.id,
        rootAddress: eventTagAddress(event) ?? undefined,
        sectionAddress: contentSearchMatch.sectionAddress,
        highlightQuery: contentSearchMatch.highlightQuery,
        contentEvent: contentSearchMatch.contentEvent
      })
    }
    navigateToNote(toNote(event), event)
  }

  const indexTitle =
    indexMetadata?.title?.trim() ||
    event.tags.find((tag) => tag[0] === 'd')?.[1]?.replace(/-/g, ' ') ||
    t('Publication Note')
  const indexSummary = indexMetadata?.summary?.trim()
  const genericSummary = (metadata.summary?.trim() || bodyBlurb).trim()

  const displayTitle = isPublicationIndex ? indexTitle : metadata.title
  const displaySummary = isPublicationIndex ? indexSummary : genericSummary
  const displayImage = isPublicationIndex ? indexMetadata?.image : metadata.image

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex w-full min-w-0 max-w-full flex-wrap gap-1 content-start">
      {metadata.tags.map((tag) => (
        <div
          key={tag}
          className="flex max-w-full min-w-0 cursor-pointer items-center gap-0.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:max-w-[min(100%,8rem)]"
          onClick={(e) => {
            e.stopPropagation()
            push(toNoteList({ hashtag: tag, kinds: [kinds.LongFormArticle] }))
          }}
        >
          <span className="shrink-0">#</span>
          <span className="min-w-0 truncate">{tag}</span>
        </div>
      ))}
    </div>
  )

  const indexFooter =
    isPublicationIndex && indexMetadata ? (
      <PublicationIndexMetadata
        event={event}
        variant="compact"
        showTitle={false}
        showSummary={false}
      />
    ) : null

  const footer = indexFooter || tagsComponent ? (
    <>
      {indexFooter}
      {tagsComponent}
    </>
  ) : null

  return (
    <ArticleHeroCard
      className={className}
      cardClassName={cn(
        presentation === 'library' && 'border-0',
        !disableNavigation && 'cursor-pointer hover:bg-muted/50'
      )}
      event={event}
      imageUrl={displayImage}
      autoLoadMedia={autoLoadMedia}
      title={displayTitle}
      summary={displaySummary || undefined}
      footer={footer}
      onClick={disableNavigation ? undefined : handleCardClick}
    />
  )
}
