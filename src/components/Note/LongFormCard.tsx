import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNote, toNoteList } from '@/lib/link'
import { useSecondaryPageOptional } from '@/PageManager'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Image from '../Image'

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
  const screenSize = useScreenSizeOptional()
  const isSmallScreen = screenSize?.isSmallScreen ?? false
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => {
    window.location.href = url
  })
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const bodyBlurb = useMemo(() => cardEventBodyBlurb(event.content), [event.content])
  const summaryText = (metadata.summary?.trim() || bodyBlurb).trim()

  const displayTitle = metadata.title?.trim() || t('Long-form Article')

  const handleCardClick = (e: React.MouseEvent) => {
    if (!interactive) return
    e.stopPropagation()
    push(toNote(event))
  }

  const titleComponent = (
    <div className="min-w-0 text-xl font-semibold break-words sm:line-clamp-2">{displayTitle}</div>
  )

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

  const summaryComponent = summaryText ? (
    <div className="text-base text-muted-foreground line-clamp-4 break-words">{summaryText}</div>
  ) : null

  const shellClass = cn(className, !interactive && 'pointer-events-none')
  const cardClass = cn(
    'rounded-lg border p-4 transition-colors',
    interactive && 'cursor-pointer hover:bg-muted/50'
  )

  if (isSmallScreen) {
    return (
      <div className={shellClass}>
        <div className={cardClass} onClick={interactive ? handleCardClick : undefined}>
          {metadata.image && autoLoadMedia && (
            <Image
              image={{ url: metadata.image, pubkey: event.pubkey }}
              className="mb-3 aspect-video w-full max-w-[400px]"
              hideIfError
            />
          )}
          <div className="space-y-2">
            {titleComponent}
            {summaryComponent}
            {tagsComponent}
            {tagsReadonly}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('w-full min-w-0', shellClass)}>
      <div className={cn(cardClass, 'min-w-0')} onClick={interactive ? handleCardClick : undefined}>
        <div className="flex min-w-0 gap-4">
          {metadata.image && autoLoadMedia && (
            <Image
              image={{ url: metadata.image, pubkey: event.pubkey }}
              classNames={{ wrapper: 'w-auto max-w-[400px] shrink-0' }}
              className="h-44 max-w-[400px] shrink rounded-lg bg-foreground object-cover aspect-[4/3] xl:aspect-video"
              hideIfError
            />
          )}
          <div className="min-w-0 flex-1 basis-0 space-y-2 overflow-hidden">
            {titleComponent}
            {summaryComponent}
            {tagsComponent}
            {tagsReadonly}
          </div>
        </div>
      </div>
    </div>
  )
}
