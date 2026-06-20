import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import Collapsible from '@/components/Collapsible'
import ShortNoteEditDiffContent from '@/components/Note/ShortNoteEditDiffContent'
import type { ShortNoteEditState } from '@/lib/short-note-edits'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { Event } from 'nostr-tools'

export default function ShortNoteEditIndicator({
  originalEvent,
  editState,
  className,
  timestampShort = false
}: {
  originalEvent: Event
  editState?: ShortNoteEditState
  className?: string
  timestampShort?: boolean
}) {
  const { t } = useTranslation()
  const latest = editState?.latestAuthorEdit
  if (!latest || latest.content === originalEvent.content) return null

  const history = editState?.authorEdits ?? []

  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-1.5', className)}>
      <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
        {t('Edited')}
      </span>
      <FormattedTimestamp
        timestamp={latest.created_at}
        className="text-xs text-muted-foreground"
        short={timestampShort}
      />
      {history.length > 1 && (
        <Collapsible
          title={t('Edit history')}
          className="text-xs text-muted-foreground [&_button]:text-xs [&_button]:font-normal"
        >
          <ul className="mt-1 space-y-2 pl-1">
            <li className="border-l-2 border-muted pl-2">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{t('Original')}</span>
                <FormattedTimestamp timestamp={originalEvent.created_at} short />
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                {originalEvent.content}
              </p>
            </li>
            {history.map((edit, idx) => {
              const prevContent =
                idx === 0 ? originalEvent.content : (history[idx - 1]?.content ?? originalEvent.content)
              return (
                <li key={edit.id} className="border-l-2 border-amber-500/40 pl-2">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{t('Revision {{n}}', { n: idx + 1 })}</span>
                    <FormattedTimestamp timestamp={edit.created_at} short />
                  </div>
                  <ShortNoteEditDiffContent
                    original={prevContent}
                    revised={edit.content}
                    className="mt-0.5 text-sm border-l-0 pl-0 ml-0"
                  />
                </li>
              )
            })}
          </ul>
        </Collapsible>
      )}
    </span>
  )
}
