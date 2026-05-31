import { getKindDescription } from '@/lib/kind-description'
import type { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

export default function NoteOptionsMetaHeader({
  event
}: {
  event: Event
  /** @deprecated Seen-on relays moved to Advanced submenu. */
  allowedRelays?: readonly string[]
  /** @deprecated */
  onNavigate?: () => void
  /** @deprecated */
  inDropdown?: boolean
}) {
  const { t } = useTranslation()
  const { description } = getKindDescription(event.kind, event)

  return (
    <div className="border-b border-border px-3 py-2.5">
      <p className="text-xs leading-snug text-muted-foreground/80" data-note-kind-label>
        {t('Note kind label line', { kind: event.kind, description })}
      </p>
    </div>
  )
}
