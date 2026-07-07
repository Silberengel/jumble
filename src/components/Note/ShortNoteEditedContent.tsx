import MarkdownArticle from '@/components/Note/LazyMarkdownArticle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ShortNoteEditDiffContent from './ShortNoteEditDiffContent'

export type ShortNoteEditedViewMode = 'diff' | 'rendered'

export default function ShortNoteEditedContent({
  original,
  revised,
  displayEvent,
  className,
  hideMetadata = false,
  lazyMedia = true,
  fullCalendarInvite
}: {
  original: string
  revised: string
  /** Kind-1 event with merged edit (and translation) content for markdown rendering. */
  displayEvent: Event
  className?: string
  hideMetadata?: boolean
  lazyMedia?: boolean
  fullCalendarInvite?: { event: Event; naddr: string }
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<ShortNoteEditedViewMode>('rendered')

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={t('Edited note display')}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant={view === 'rendered' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          aria-pressed={view === 'rendered'}
          onClick={() => setView('rendered')}
        >
          {t('Formatted view')}
        </Button>
        <Button
          type="button"
          variant={view === 'diff' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          aria-pressed={view === 'diff'}
          onClick={() => setView('diff')}
        >
          {t('Show changes')}
        </Button>
      </div>
      {view === 'diff' ? (
        <ShortNoteEditDiffContent original={original} revised={revised} />
      ) : (
        <MarkdownArticle
          event={displayEvent}
          hideMetadata={hideMetadata}
          lazyMedia={lazyMedia}
          fullCalendarInvite={fullCalendarInvite}
        />
      )}
    </div>
  )
}
