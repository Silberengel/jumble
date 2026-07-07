import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote, toNoteList } from '@/lib/link'
import { useSecondaryPageOptional } from '@/PageManager'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { Event, kinds } from 'nostr-tools'
import { BookMarked } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ArticleHeroCard from './ArticleHeroCard'

export default function WikiCard({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
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
    <div className="inline-flex w-fit items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white/90">
      <BookMarked className="h-3 w-3" />
      {t('Nostr Wiki')}
    </div>
  )

  const tagsComponent = metadata.tags.length > 0 && (
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

  return (
    <ArticleHeroCard
      className={className}
      cardClassName="cursor-pointer hover:bg-muted/50"
      event={event}
      imageUrl={metadata.image}
      autoLoadMedia={autoLoadMedia}
      hideImageIfError
      eyebrow={labelComponent}
      title={metadata.title}
      summary={summaryText || undefined}
      footer={tagsComponent}
      onClick={handleCardClick}
    />
  )
}
