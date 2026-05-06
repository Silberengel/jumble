import {
  buildInteractionPartnerStats,
  mergeEventsById,
  type TInteractionPartnerStat
} from '@/lib/profile-interaction-partners'
import { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { useCallback, useEffect, useState } from 'react'
import { kinds } from 'nostr-tools'

const INTERACTION_KINDS = [kinds.ShortTextNote, kinds.Repost, kinds.Reaction] as const

export function useProfileInteractionPartners(authorPubkey: string | undefined, refreshNonce = 0) {
  const [partners, setPartners] = useState<TInteractionPartnerStat[]>([])
  const [loading, setLoading] = useState(false)
  const [archiveAuthorEvents, setArchiveAuthorEvents] = useState(0)
  const [sessionEventCount, setSessionEventCount] = useState(0)

  const run = useCallback(async () => {
    const pk = authorPubkey?.trim().toLowerCase()
    if (!pk || !/^[0-9a-f]{64}$/.test(pk)) {
      setPartners([])
      setArchiveAuthorEvents(0)
      setSessionEventCount(0)
      return
    }
    setLoading(true)
    try {
      const kindsArr = [...INTERACTION_KINDS]
      const sessionEv = eventService.listSessionEventsAuthoredBy(pk, { kinds: kindsArr, limit: 900 })
      setSessionEventCount(sessionEv.length)

      const idbEv = await indexedDb.scanEventArchiveByAuthorPubkey(pk, {
        kinds: kindsArr,
        maxRowsScanned: 14_000,
        maxMatches: 450
      })
      setArchiveAuthorEvents(idbEv.length)

      const merged = mergeEventsById([...sessionEv, ...idbEv])
      setPartners(buildInteractionPartnerStats(merged, pk))
    } finally {
      setLoading(false)
    }
  }, [authorPubkey])

  useEffect(() => {
    void run()
  }, [run, refreshNonce])

  return { partners, loading, rescan: run, archiveAuthorEvents, sessionEventCount }
}
