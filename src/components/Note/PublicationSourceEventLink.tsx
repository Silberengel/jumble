import { useFetchEvent } from '@/hooks'
import {
  getPublicationSourceEventRefFromIndex,
  resolvePublicationSourceEventBech32,
  truncatePublicationSourceBech32
} from '@/lib/publication-source-event'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartNoteNavigationOptional } from '@/PageManager'
import type { Event } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function PublicationSourceEventLink({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigationOptional()
  const sourceRef = useMemo(() => getPublicationSourceEventRefFromIndex(event), [event])
  const { event: fetchedSource } = useFetchEvent(
    sourceRef?.eventId,
    undefined,
    sourceRef?.relay ? { relayHints: [sourceRef.relay] } : undefined
  )

  const bech32 = useMemo(() => {
    if (!sourceRef) return undefined
    return resolvePublicationSourceEventBech32(sourceRef, fetchedSource)
  }, [sourceRef, fetchedSource])

  if (!sourceRef || !bech32) return null

  const label = truncatePublicationSourceBech32(bech32)

  return (
    <div className={cn('min-w-0 text-muted-foreground', className)}>
      <span>{t('Publication originally published on')} </span>
      <button
        type="button"
        className="inline max-w-full truncate text-primary hover:underline"
        title={bech32}
        onClick={(e) => {
          e.stopPropagation()
          navigateToNote(toNote(bech32), fetchedSource)
        }}
      >
        {label}
      </button>
    </div>
  )
}
