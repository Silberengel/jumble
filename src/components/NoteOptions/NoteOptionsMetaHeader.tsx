import RelayIcon from '@/components/RelayIcon'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useSeenOnRelays } from '@/hooks/useSeenOnRelays'
import { getKindDescription } from '@/lib/kind-description'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { useSmartRelayNavigation } from '@/PageManager'
import type { Event } from 'nostr-tools'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export default function NoteOptionsMetaHeader({
  event,
  allowedRelays,
  onNavigate,
  inDropdown = false
}: {
  event: Event
  allowedRelays?: readonly string[]
  onNavigate?: () => void
  inDropdown?: boolean
}) {
  const { t } = useTranslation()
  const { navigateToRelay } = useSmartRelayNavigation()
  const relays = useSeenOnRelays(event.id, allowedRelays)
  const { description } = getKindDescription(event.kind, event)

  const openRelayFeed = useCallback(
    (relay: string) => {
      onNavigate?.()
      setTimeout(() => {
        navigateToRelay(toRelay(relay))
      }, 0)
    },
    [navigateToRelay, onNavigate]
  )

  const relayRows = relays.map((relay) => {
    const label = (
      <>
        <RelayIcon url={relay} className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{simplifyUrl(relay)}</span>
      </>
    )

    if (inDropdown) {
      return (
        <DropdownMenuItem
          key={relay}
          asChild
          onSelect={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="flex min-w-0 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
            onClick={() => openRelayFeed(relay)}
          >
            {label}
          </button>
        </DropdownMenuItem>
      )
    }

    return (
      <li key={relay}>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-foreground hover:bg-muted"
          onClick={() => openRelayFeed(relay)}
        >
          {label}
        </button>
      </li>
    )
  })

  return (
    <div className="space-y-2 border-b border-border px-3 py-2.5">
      <p className="text-xs leading-snug text-muted-foreground/80" data-note-kind-label>
        {t('Note kind label line', { kind: event.kind, description })}
      </p>
      {relays.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('Seen on')}
          </p>
          {inDropdown ? (
            <div className="space-y-0.5">{relayRows}</div>
          ) : (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto overscroll-y-contain">{relayRows}</ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
