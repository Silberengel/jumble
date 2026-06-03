import { getProfileFromEvent } from '@/lib/event-metadata'
import { filterPubkeysByListSearch } from '@/lib/filter-pubkeys-by-profile-search'
import indexedDb from '@/services/indexed-db.service'
import type { TProfile } from '@/types'
import { useEffect, useMemo, useState } from 'react'

/** Filter a pubkey list by search; enriches matches from cached kind-0 rows in IndexedDB. */
export function usePubkeyListSearchProfiles(pubkeys: string[]) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchProfileMap, setSearchProfileMap] = useState<Map<string, TProfile>>(() => new Map())

  const pubkeysKey = useMemo(() => pubkeys.join('\u0001'), [pubkeys])
  const pubkeysSet = useMemo(
    () => new Set(pubkeys.map((pk) => pk.toLowerCase())),
    [pubkeysKey]
  )

  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchProfileMap(new Map())
      return
    }

    let cancelled = false
    void indexedDb
      .searchProfileEventsInCache(q, Math.min(Math.max(pubkeys.length, 50), 500))
      .then((events) => {
        if (cancelled) return
        const next = new Map<string, TProfile>()
        for (const ev of events) {
          const pk = ev.pubkey.toLowerCase()
          if (!pubkeysSet.has(pk)) continue
          next.set(pk, { ...getProfileFromEvent(ev), pubkey: pk })
        }
        setSearchProfileMap(next)
      })
      .catch(() => {
        if (!cancelled) setSearchProfileMap(new Map())
      })

    return () => {
      cancelled = true
    }
  }, [searchQuery, pubkeysSet, pubkeysKey, pubkeys.length])

  const filteredPubkeys = useMemo(
    () => filterPubkeysByListSearch(pubkeys, searchProfileMap, searchQuery),
    [pubkeys, pubkeysKey, searchProfileMap, searchQuery]
  )

  return {
    searchQuery,
    setSearchQuery,
    filteredPubkeys,
    searchProfileMap
  }
}
