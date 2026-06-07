import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote, toNoteList } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPageOptional, useSmartNoteNavigationOptional } from '@/PageManager'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import Image from '../Image'
import { extractBookMetadata } from '@/lib/bookstr-parser'
import { persistLibraryPublicationForReading } from '@/lib/library-publication-index'
import { ExtendedKind } from '@/constants'

export default function PublicationCard({
  event,
  className,
  disableNavigation = false
}: {
  event: Event
  className?: string
  /** When true (e.g. full note view), card is display-only; no navigate-to-note on click. */
  disableNavigation?: boolean
}) {
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const bodyBlurb = useMemo(() => cardEventBodyBlurb(event.content), [event.content])
  const summaryText = (metadata.summary?.trim() || bodyBlurb).trim()
  const bookMetadata = useMemo(() => extractBookMetadata(event), [event])
  const isBookstrEvent = (event.kind === ExtendedKind.PUBLICATION || event.kind === ExtendedKind.PUBLICATION_CONTENT) && !!bookMetadata.book

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disableNavigation) return
    persistLibraryPublicationForReading(event)
    navigateToNote(toNote(event), event)
  }

  const titleComponent = metadata.title ? <div className="text-xl font-semibold break-words min-w-0 sm:line-clamp-2">{metadata.title}</div> : null

  const formatBookName = (book: string) => {
    return book
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  const bookstrMetadataComponent = isBookstrEvent && (
    <div className="flex min-w-0 max-w-full flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {bookMetadata.type && <span>Type: {bookMetadata.type}</span>}
      {bookMetadata.book && <span>Book: {formatBookName(bookMetadata.book)}</span>}
      {bookMetadata.chapter && <span>Chapter: {bookMetadata.chapter}</span>}
      {bookMetadata.verse && <span>Verse: {bookMetadata.verse}</span>}
      {bookMetadata.version && <span>Version: {bookMetadata.version.toUpperCase()}</span>}
    </div>
  )

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

  if (isSmallScreen) {
    return (
      <div className={cn('w-full min-w-0', className)}>
        <div
          className={cn(
            'min-w-0 rounded-lg border p-4 transition-colors',
            disableNavigation ? '' : 'cursor-pointer hover:bg-muted/50'
          )}
          onClick={disableNavigation ? undefined : handleCardClick}
        >
          {metadata.image ? (
            <Image
              image={{ url: metadata.image, pubkey: event.pubkey }}
              className="mb-3 aspect-video w-full max-w-full"
              hideIfError
              holdUntilClick={!autoLoadMedia}
            />
          ) : null}
          <div className="min-w-0 space-y-2 overflow-hidden">
            {titleComponent}
            {bookstrMetadataComponent}
            {!titleComponent && bookstrMetadataComponent && <div className="h-0" />}
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
        className={cn(
          'min-w-0 overflow-hidden rounded-lg border p-4 transition-colors',
          disableNavigation ? '' : 'cursor-pointer hover:bg-muted/50'
        )}
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
          ) : null}
          <div className="min-h-0 min-w-[10rem] flex-1 basis-0 space-y-2 overflow-hidden">
            {titleComponent}
            {bookstrMetadataComponent}
            {!titleComponent && bookstrMetadataComponent && <div className="h-0" />}
            {summaryComponent}
            {tagsComponent}
          </div>
        </div>
      </div>
    </div>
  )
}
