import logger from '@/lib/logger'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { TRelayList } from '@/types'
import { kinds } from 'nostr-tools'
import { useEffect, useState } from 'react'

const emptyRelayList = (): TRelayList => ({
  write: [],
  read: [],
  originalRelays: [],
  httpRead: [],
  httpWrite: [],
  httpOriginalRelays: []
})

export function useFetchRelayList(pubkey?: string | null) {
  const [relayList, setRelayList] = useState<TRelayList>(emptyRelayList)
  const [isFetching, setIsFetching] = useState(true)
  /** True when IndexedDB has this author's kind 10002 (even if `originalRelays` is empty after merge). */
  const [hasKind10002InStorage, setHasKind10002InStorage] = useState(false)

  useEffect(() => {
    let cancelled = false
    const targetPk = pubkey?.trim() || null

    const fetchRelayList = async () => {
      setIsFetching(true)
      setHasKind10002InStorage(false)
      if (!targetPk) {
        setRelayList(emptyRelayList())
        setIsFetching(false)
        return
      }

      setRelayList(emptyRelayList())

      try {
        const [fromStorage, k10002] = await Promise.all([
          client.peekRelayListFromStorage(targetPk),
          indexedDb.getReplaceableEvent(targetPk, kinds.RelayList).catch(() => null)
        ])
        if (cancelled) return
        setHasKind10002InStorage(!!k10002)
        setRelayList(fromStorage)

        const merged = await client.fetchRelayList(targetPk)
        if (cancelled) return
        setRelayList(merged)
        const k10002After = await indexedDb.getReplaceableEvent(targetPk, kinds.RelayList).catch(() => null)
        if (!cancelled) {
          setHasKind10002InStorage(!!k10002After)
        }
      } catch (err) {
        logger.error('Failed to fetch relay list', { error: err, pubkey: targetPk })
        try {
          const fallback = await client.peekRelayListFromStorage(targetPk)
          const k10002 = await indexedDb.getReplaceableEvent(targetPk, kinds.RelayList).catch(() => null)
          if (!cancelled) {
            setRelayList(fallback)
            setHasKind10002InStorage(!!k10002)
          }
        } catch {
          if (!cancelled) {
            setRelayList(emptyRelayList())
          }
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false)
        }
      }
    }

    void fetchRelayList()
    return () => {
      cancelled = true
    }
  }, [pubkey])

  const showingRelayListFallback =
    !isFetching &&
    !hasKind10002InStorage &&
    relayList.originalRelays.length === 0

  return { relayList, isFetching, hasKind10002InStorage, showingRelayListFallback }
}
