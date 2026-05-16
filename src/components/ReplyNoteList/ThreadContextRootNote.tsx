import { useFetchEvent } from '@/hooks'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { generateBech32IdFromETag } from '@/lib/tag'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import Note from '@/components/Note'
import { LoadingBar } from '@/components/LoadingBar'
import { useNostr } from '@/providers/NostrProvider'
import noteStatsService from '@/services/note-stats.service'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Event } from 'nostr-tools'

/**
 * Thread OP at the top of “Antworten” when the open note is a reply (not the root).
 */
export default function ThreadContextRootNote({
  rootHex,
  contextEvent
}: {
  rootHex: string
  /** Note whose tags supply relay hints for fetching the root. */
  contextEvent: Event
}) {
  const { t } = useTranslation()
  const rootId = useMemo(() => {
    const hex = rootHex.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/i.test(hex)) return hex
    try {
      return generateBech32IdFromETag(['e', hex]) ?? hex
    } catch {
      return hex
    }
  }, [rootHex])
  const fetchOpts = useMemo(() => {
    const hints = relayHintsFromEventTags(contextEvent)
    return hints.length ? { relayHints: hints } : undefined
  }, [contextEvent])
  const { event: rootEvent, isFetching } = useFetchEvent(rootId, undefined, fetchOpts)
  const { pubkey } = useNostr()
  const { relays: statsRelays, currentRelaysKey } = useNoteStatsRelayHints()

  useEffect(() => {
    if (!rootEvent) return
    void noteStatsService.fetchNoteStats(rootEvent, pubkey, statsRelays, { foreground: true })
  }, [rootEvent, pubkey, statsRelays, currentRelaysKey])

  if (isFetching && !rootEvent) {
    return (
      <div className="border-b border-border/50 pb-3 mb-2">
        <p className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('Original post')}
        </p>
        <LoadingBar />
      </div>
    )
  }
  if (!rootEvent) return null

  return (
    <div className="border-b border-border/60 pb-3 mb-3">
      <p className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('Original post')}
      </p>
      <Note event={rootEvent} hideParentNotePreview className="opacity-95" />
    </div>
  )
}
