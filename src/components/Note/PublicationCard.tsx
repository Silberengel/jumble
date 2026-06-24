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
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import Image from '../Image'
import ArticleCardCoverImage from './ArticleCardCoverImage'
import PublicationCoverFallback from './PublicationCoverFallback'
import PublicationCoverImage from './PublicationCoverImage'
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
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const useStackedLayout = presentation === 'library' || isSmallScreen
  const coverSize = presentation === 'library' ? 'library' : 'default'
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const indexMetadata = useMemo(
    () => (event.kind === ExtendedKind.PUBLICATION ? getPublicationIndexMetadataFromEvent(event) : null),
    [event]
  )
  const bodyBlurb = useMemo(() => cardEventBodyBlurb(event.content), [event.content])
  const summaryText = (metadata.summary?.trim() || bodyBlurb).trim()
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

  const titleComponent = metadata.title ? (
    <div className="min-w-0 text-xl font-semibold break-words sm:line-clamp-2">{metadata.title}</div>
  ) : null

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex w-full min-w-0 max-w-full flex-wrap gap-1 content-start">
      {metadata.tags.map((tag) => (
        <div
          key={tag}
          className="flex max-w-full min-w-0 items-center gap-0.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground sm:max-w-[min(100%,8rem)]"
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

  const summaryComponent = summaryText ? (
    <div className="min-w-0 max-w-full text-base text-muted-foreground line-clamp-4 break-words">
      {summaryText}
    </div>
  ) : null

  const cardShellClass = cn(
    'min-w-0 rounded-lg border transition-colors',
    presentation === 'library' ? 'border-0 p-3' : 'border p-4',
    disableNavigation ? '' : 'cursor-pointer hover:bg-muted/50'
  )

  if (isPublicationIndex && indexMetadata) {
    const coverImage = indexMetadata.image?.trim()
    const coverLayout = useStackedLayout ? 'stacked' : 'row'
    const cover = coverImage ? (
      <PublicationCoverImage
        imageUrl={coverImage}
        pubkey={event.pubkey}
        autoLoadMedia={autoLoadMedia}
        size={coverSize}
        layout={coverLayout}
      />
    ) : (
      <PublicationCoverFallback layout={coverLayout} size={coverSize} />
    )

    if (useStackedLayout) {
      return (
        <div className={cn('w-full min-w-0', className)}>
          <div className={cardShellClass} onClick={disableNavigation ? undefined : handleCardClick}>
            {cover}
            <PublicationIndexMetadata event={event} variant="compact" />
          </div>
        </div>
      )
    }

    return (
      <div className={cn('w-full min-w-0', className)}>
        <div
          className={cn(cardShellClass, 'overflow-hidden')}
          onClick={disableNavigation ? undefined : handleCardClick}
        >
          <div className="flex min-w-0 items-start gap-4">
            {cover}
            <PublicationIndexMetadata event={event} variant="compact" className="min-h-0 min-w-0 flex-1 basis-0" />
          </div>
        </div>
      </div>
    )
  }

  if (isSmallScreen) {
    return (
      <div className={cn('w-full min-w-0', className)}>
        <div className={cardShellClass} onClick={disableNavigation ? undefined : handleCardClick}>
          {metadata.image ? (
            <Image
              image={{ url: metadata.image, pubkey: event.pubkey }}
              className="mb-3 aspect-video w-full max-w-full"
              hideIfError
              holdUntilClick={!autoLoadMedia}
            />
          ) : (
            <ArticleCardCoverImage
              event={event}
              imageUrl={metadata.image}
              autoLoadMedia={autoLoadMedia}
              layout="stacked"
            />
          )}
          <div className="min-w-0 space-y-2 overflow-hidden">
            {titleComponent}
            {summaryComponent}
            {tagsComponent}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div
        className={cn(cardShellClass, 'overflow-hidden')}
        onClick={disableNavigation ? undefined : handleCardClick}
      >
        <div className="flex min-w-0 gap-4">
          {metadata.image ? (
            <Image
              image={{ url: metadata.image, pubkey: event.pubkey }}
              classNames={{ wrapper: 'w-auto max-w-[min(400px,42%)] shrink-0 xl:max-w-[400px]' }}
              className="aspect-[4/3] h-44 max-h-44 w-auto max-w-[min(400px,42%)] min-w-0 shrink rounded-lg bg-foreground object-cover xl:aspect-video xl:max-w-[400px]"
              hideIfError
              holdUntilClick={!autoLoadMedia}
            />
          ) : (
            <ArticleCardCoverImage
              event={event}
              imageUrl={metadata.image}
              autoLoadMedia={autoLoadMedia}
              layout="row"
            />
          )}
          <div className="min-h-0 min-w-[10rem] flex-1 basis-0 space-y-2 overflow-hidden">
            {titleComponent}
            {summaryComponent}
            {tagsComponent}
          </div>
        </div>
      </div>
    </div>
  )
}
