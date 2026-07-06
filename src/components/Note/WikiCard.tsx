import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { toNote, toNoteList } from '@/lib/link'
import { useSecondaryPageOptional } from '@/PageManager'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { Event, kinds } from 'nostr-tools'
import { BookMarked } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ArticleCardCoverImage from './ArticleCardCoverImage'

export default function WikiCard({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const bodyBlurb = useMemo(
    () => cardEventBodyBlurb(event.content, { markup: 'asciidoc' }),
    [event.content]
  )
  const summaryText = (metadata.summary?.trim() || bodyBlurb).trim()

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    push(toNote(event))
  }

  const labelComponent = (
    <div className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
      <BookMarked className="h-3 w-3" />
      {t('Nostr Wiki')}
    </div>
  )

  const titleComponent = <div className="text-xl font-semibold break-words min-w-0 sm:line-clamp-2">{metadata.title}</div>

  const tagsComponent = metadata.tags.length > 0 && (
    <div className="flex gap-1 flex-wrap">
      {metadata.tags.map((tag) => (
        <div
          key={tag}
          className="flex items-center rounded-full text-xs px-2.5 py-0.5 bg-muted text-muted-foreground max-w-32 cursor-pointer hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => {
            e.stopPropagation()
            push(toNoteList({ hashtag: tag, kinds: [kinds.LongFormArticle] }))
          }}
        >
          #<span className="truncate">{tag}</span>
        </div>
      ))}
    </div>
  )

  const summaryComponent = summaryText ? (
    <div className="text-base text-muted-foreground line-clamp-4 break-words">{summaryText}</div>
  ) : null

  if (isSmallScreen) {
    return (
      <div className={cn('w-full min-w-0', className)}>
        <div 
          className="min-w-0 cursor-pointer rounded-lg border p-4 hover:bg-muted/50 transition-colors"
          onClick={handleCardClick}
        >
          <ArticleCardCoverImage
            event={event}
            imageUrl={metadata.image}
            autoLoadMedia={autoLoadMedia}
            layout="stacked"
            hideImageIfError
          />
          <div className="min-w-0 space-y-2">
            {labelComponent}
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
        className="min-w-0 cursor-pointer rounded-lg border p-4 hover:bg-muted/50 transition-colors"
        onClick={handleCardClick}
      >
        <div className="flex min-w-0 gap-4">
          <ArticleCardCoverImage
            event={event}
            imageUrl={metadata.image}
            autoLoadMedia={autoLoadMedia}
            layout="row"
            hideImageIfError
          />
          <div className="min-w-0 flex-1 basis-0 space-y-2 overflow-hidden">
            {labelComponent}
            {titleComponent}
            {summaryComponent}
            {tagsComponent}
          </div>
        </div>
      </div>
    </div>
  )
}
