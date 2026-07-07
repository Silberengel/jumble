import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote, toNoteList } from '@/lib/link'
import { useSecondaryPageOptional } from '@/PageManager'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ArticleHeroCard from './ArticleHeroCard'

/**
 * Feed / embed / preview surface for NIP-23 long-form (kind 30023): title, summary, image, tags — no “Show more” body.
 * Full article stays on the note page ({@link showFull} on {@link Note}).
 */
export default function LongFormCard({
  event,
  className,
  /** When false (e.g. parent-reply preview strip), card is non-interactive like the old one-line preview. */
  interactive = true
}: {
  event: Event
  className?: string
  interactive?: boolean
}) {
  const { t } = useTranslation()
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => {
    window.location.href = url
  })
  const autoLoadMedia = useShouldAutoLoadMedia(event.pubkey, event)
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const bodyBlurb = useMemo(() => cardEventBodyBlurb(event.content), [event.content])
  const summaryText = (metadata.summary?.trim() || bodyBlurb).trim()

  const displayTitle = metadata.title?.trim() || t('Long-form Article')

  const handleCardClick = (e: React.MouseEvent) => {
    if (!interactive) return
    e.stopPropagation()
    push(toNote(event))
  }

  const tagsComponent = interactive && metadata.tags.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {metadata.tags.map((tag) => (
        <div
          key={tag}
          className="flex max-w-32 cursor-pointer items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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

  const tagsReadonly = !interactive && metadata.tags.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {metadata.tags.map((tag) => (
        <span
          key={tag}
          className="flex max-w-32 items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
        >
          #<span className="truncate">{tag}</span>
        </span>
      ))}
    </div>
  )

  return (
    <ArticleHeroCard
      className={cn(className, !interactive && 'pointer-events-none')}
      cardClassName={cn(interactive && 'cursor-pointer hover:bg-muted/50')}
      event={event}
      imageUrl={metadata.image}
      autoLoadMedia={autoLoadMedia}
      title={displayTitle}
      summary={summaryText || undefined}
      footer={tagsComponent || tagsReadonly}
      onClick={interactive ? handleCardClick : undefined}
    />
  )
}
