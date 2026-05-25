import { Button } from '@/components/ui/button'
import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { downloadEventAsMarkdownFile } from '@/lib/download-event-markdown'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { parseNostrSpecAffectedKindsFromEvent } from '@/lib/nostr-spec-affected-kinds'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPageOptional } from '@/PageManager'
import { Download } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Compact feed card for Nostr specifications (kind 30817): title, short blurb, affected kinds — no cover images.
 */
export default function NostrSpecCard({
  event,
  className,
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
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const bodyBlurb = useMemo(() => cardEventBodyBlurb(event.content), [event.content])
  const summaryText = (metadata.summary?.trim() || bodyBlurb).trim()
  const affectedKinds = useMemo(() => parseNostrSpecAffectedKindsFromEvent(event), [event])
  const displayTitle = metadata.title?.trim() || t('Nostr Specification')

  const handleCardClick = (e: React.MouseEvent) => {
    if (!interactive) return
    e.stopPropagation()
    push(toNote(event))
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      downloadEventAsMarkdownFile(event, metadata.title)
      toast.success(t('Article exported as Markdown'))
    } catch {
      toast.error(t('Failed to export article'))
    }
  }

  const cardClass = cn(
    'rounded-lg border px-3 py-2.5 transition-colors',
    interactive && 'cursor-pointer hover:bg-muted/50'
  )

  return (
    <div className={cn(className, !interactive && 'pointer-events-none')}>
      <div className={cardClass} onClick={interactive ? handleCardClick : undefined}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-base font-semibold leading-snug break-words line-clamp-2">{displayTitle}</div>
            {summaryText ? (
              <p className="text-sm leading-snug text-muted-foreground line-clamp-2 break-words">{summaryText}</p>
            ) : null}
            {affectedKinds.length > 0 ? (
              <p className="text-xs tabular-nums text-muted-foreground/90">
                {t('Nostr spec affected kinds', {
                  kinds: affectedKinds.join(', ')
                })}
              </p>
            ) : null}
          </div>
          {interactive ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              title={t('Download as Markdown file')}
              aria-label={t('Download as Markdown file')}
              onClick={handleDownload}
            >
              <Download className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
