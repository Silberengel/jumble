import { musicTrackPreviewText } from '@/components/Note/MusicTrackNote'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

export default function MusicTrackNotePreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const line = musicTrackPreviewText(event).trim()

  return (
    <div className={cn('pointer-events-none min-w-0 truncate text-sm italic', className)}>
      {line || t('Music track', { defaultValue: 'Music track' })}
    </div>
  )
}
