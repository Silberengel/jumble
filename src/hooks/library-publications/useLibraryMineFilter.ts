import {
  filterLibraryPublicationsByUser,
  libraryPublicationEntriesForUserFromIndexAsync,
  type LibraryMineFilterOpts,
  type LibraryPublicationEntry,
  type LibraryPublicationFilterMode
} from '@/lib/library-publication-index'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_ENGAGEMENT } from './constants'

export function useLibraryMineFilter(params: {
  filterMode: LibraryPublicationFilterMode
  pubkey: string | null | undefined
  indexEvents: Event[]
  debouncedSearch: string
  bookmarkListEvent: Event | undefined | null
  pinListEvent: Event | null
  myBooklistTargets: { addresses: Set<string>; eventIds: Set<string> }
}) {
  const {
    filterMode,
    pubkey,
    indexEvents,
    debouncedSearch,
    bookmarkListEvent,
    pinListEvent,
    myBooklistTargets
  } = params

  const [mineIndexEntries, setMineIndexEntries] = useState<LibraryPublicationEntry[]>([])
  const [mineFilterComputing, setMineFilterComputing] = useState(false)
  const mineIndexCacheRef = useRef<{
    indexEvents: Event[]
    pubkey: string
    mineFilterOpts: LibraryMineFilterOpts
    entries: LibraryPublicationEntry[]
  } | null>(null)

  const mineFilterOpts = useMemo(
    () => ({
      bookmarkListEvent,
      pinListEvent,
      myBooklistAddresses: myBooklistTargets.addresses,
      myBooklistEventIds: myBooklistTargets.eventIds
    }),
    [bookmarkListEvent, pinListEvent, myBooklistTargets]
  )

  useEffect(() => {
    if (filterMode !== 'mine' || !pubkey || indexEvents.length === 0 || debouncedSearch.trim()) {
      setMineFilterComputing(false)
      return
    }

    const cached = mineIndexCacheRef.current
    if (
      cached &&
      cached.indexEvents === indexEvents &&
      cached.pubkey === pubkey &&
      cached.mineFilterOpts === mineFilterOpts
    ) {
      setMineIndexEntries(cached.entries)
      setMineFilterComputing(false)
      return
    }

    const signal = { cancelled: false }
    setMineFilterComputing(true)

    void libraryPublicationEntriesForUserFromIndexAsync(
      indexEvents,
      EMPTY_ENGAGEMENT,
      pubkey,
      mineFilterOpts,
      signal
    ).then((computed) => {
      if (signal.cancelled) return
      mineIndexCacheRef.current = {
        indexEvents,
        pubkey,
        mineFilterOpts,
        entries: computed
      }
      setMineIndexEntries(computed)
      setMineFilterComputing(false)
    })

    return () => {
      signal.cancelled = true
    }
  }, [filterMode, pubkey, indexEvents, mineFilterOpts, debouncedSearch])

  const filterEntriesForMine = useCallback(
    (list: LibraryPublicationEntry[]) => {
      if (filterMode !== 'mine' || !pubkey) return list
      return filterLibraryPublicationsByUser(list, pubkey, mineFilterOpts)
    },
    [filterMode, pubkey, mineFilterOpts]
  )

  return {
    mineIndexEntries,
    mineFilterComputing,
    mineFilterOpts,
    filterEntriesForMine
  }
}
