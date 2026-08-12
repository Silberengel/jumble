import { FETCH_RELAY_LIST_HOOK_MAX_MS } from '@/constants'
import { getRelayListFromEvent } from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { relayListHasUsableMailboxUrls } from '@/lib/viewer-relay-defaults'
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
  /** True when IndexedDB has a usable kind 10002 (not missing / not profile-index-only). */
  const [hasUsableKind10002InStorage, setHasUsableKind10002InStorage] = useState(false)

  useEffect(() => {
    let cancelled = false
    const targetPk = pubkey?.trim() || null

    const usableFromStoredEvent = async (pk: string): Promise<boolean> => {
      const k10002 = await indexedDb.getReplaceableEvent(pk, kinds.RelayList).catch(() => null)
      if (!k10002) return false
      return relayListHasUsableMailboxUrls(getRelayListFromEvent(k10002))
    }

    const fetchRelayList = async () => {
      setIsFetching(true)
      setHasUsableKind10002InStorage(false)
      if (!targetPk) {
        setRelayList(emptyRelayList())
        setIsFetching(false)
        return
      }

      setRelayList(emptyRelayList())

      try {
        const [fromStorage, usable] = await Promise.all([
          client.peekRelayListFromStorage(targetPk),
          usableFromStoredEvent(targetPk)
        ])
        if (cancelled) return
        setHasUsableKind10002InStorage(usable)
        setRelayList(fromStorage)

        const merged = await Promise.race([
          client.fetchRelayList(targetPk),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('relay-list hook max wait')), FETCH_RELAY_LIST_HOOK_MAX_MS)
          })
        ]).catch(async (err: unknown) => {
          const isMaxWait = err instanceof Error && err.message === 'relay-list hook max wait'
          if (isMaxWait) {
            logger.warn('[useFetchRelayList] fetchRelayList exceeded max wait; clearing dedupe cache', {
              pubkeyPrefix: targetPk.slice(0, 12)
            })
            client.clearRelayListCache(targetPk)
            return client.peekRelayListFromStorage(targetPk)
          }
          throw err
        })
        if (cancelled) return
        setRelayList(merged)
        const usableAfter = await usableFromStoredEvent(targetPk)
        if (!cancelled) {
          setHasUsableKind10002InStorage(usableAfter)
        }
      } catch (err) {
        logger.error('Failed to fetch relay list', { error: err, pubkey: targetPk })
        try {
          const fallback = await client.peekRelayListFromStorage(targetPk)
          const usable = await usableFromStoredEvent(targetPk)
          if (!cancelled) {
            setRelayList(fallback)
            setHasUsableKind10002InStorage(usable)
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

  /** True when no usable kind 10002 — UI may show FAST_* defaults / empty with a disclaimer. */
  const showingRelayListFallback = !isFetching && !hasUsableKind10002InStorage

  return {
    relayList,
    isFetching,
    hasKind10002InStorage: hasUsableKind10002InStorage,
    showingRelayListFallback
  }
}
