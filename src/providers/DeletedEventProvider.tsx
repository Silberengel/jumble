import { getKeyForDeletedLookup } from '@/lib/deleted-event-key'
import { isTombstoneKeyForEvent } from '@/lib/event'
import { TOMBSTONES_UPDATED_EVENT, type TombstonesUpdatedDetail } from '@/lib/tombstone-events'
import indexedDb from '@/services/indexed-db.service'
import { NostrEvent } from 'nostr-tools'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type TDeletedEventContext = {
  addDeletedEvent: (event: NostrEvent) => void
  addDeletedEventId: (eventId: string) => void
  isEventDeleted: (event: NostrEvent) => boolean
  /** Bumps when tombstones are reloaded from IndexedDB (for list re-filtering). */
  tombstoneEpoch: number
}

const DeletedEventContext = createContext<TDeletedEventContext | undefined>(undefined)

const noopIsEventDeleted = () => false
const noopAddDeletedEvent = () => {}
const noopAddDeletedEventId = () => {}

const DELETED_EVENT_CONTEXT_FALLBACK: TDeletedEventContext = {
  addDeletedEvent: noopAddDeletedEvent,
  addDeletedEventId: noopAddDeletedEventId,
  isEventDeleted: noopIsEventDeleted,
  tombstoneEpoch: 0
}

/** Returns undefined outside provider (e.g. Asciidoc `createRoot` embeds before wrappers mount). */
export function useDeletedEventOptional(): TDeletedEventContext | undefined {
  return useContext(DeletedEventContext)
}

/** Non-throwing; use in feeds/lists that only filter tombstones (survives HMR context splits). */
export function useDeletedEventSafe(): TDeletedEventContext {
  return useDeletedEventOptional() ?? DELETED_EVENT_CONTEXT_FALLBACK
}

export const useDeletedEvent = () => {
  const context = useDeletedEventOptional()
  if (!context) {
    throw new Error('useDeletedEvent must be used within a DeletedEventProvider')
  }
  return context
}

/** Safe for hooks used inside optional provider trees (embedded notes, etc.). */
export function useIsEventDeleted(): (event: NostrEvent) => boolean {
  return useDeletedEventOptional()?.isEventDeleted ?? noopIsEventDeleted
}

export function DeletedEventProvider({ children }: { children: React.ReactNode }) {
  const [tombstoneKeys, setTombstoneKeys] = useState<Set<string>>(() => new Set())
  const [tombstoneEpoch, setTombstoneEpoch] = useState(0)

  const hydrateFromIndexedDb = useCallback(async () => {
    try {
      const keys = await indexedDb.getAllTombstones()
      setTombstoneKeys(keys)
      setTombstoneEpoch((e) => e + 1)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void hydrateFromIndexedDb()
  }, [hydrateFromIndexedDb])

  useEffect(() => {
    const onUpdate = (ev: Event) => {
      const keys = (ev as CustomEvent<TombstonesUpdatedDetail>).detail?.keys
      if (keys?.length) {
        setTombstoneKeys((prev) => {
          const next = new Set(prev)
          for (const key of keys) next.add(key)
          return next
        })
        setTombstoneEpoch((e) => e + 1)
      }
      void hydrateFromIndexedDb()
    }
    window.addEventListener(TOMBSTONES_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(TOMBSTONES_UPDATED_EVENT, onUpdate)
  }, [hydrateFromIndexedDb])

  const isEventDeleted = useCallback(
    (event: NostrEvent) => isTombstoneKeyForEvent(event, tombstoneKeys),
    [tombstoneKeys]
  )

  const addDeletedEvent = useCallback((event: NostrEvent) => {
    const key = getKeyForDeletedLookup(event)
    setTombstoneKeys((prev) => new Set(prev).add(key))
    setTombstoneEpoch((e) => e + 1)
  }, [])

  const addDeletedEventId = useCallback((eventId: string) => {
    setTombstoneKeys((prev) => new Set(prev).add(eventId))
    setTombstoneEpoch((e) => e + 1)
  }, [])

  return (
    <DeletedEventContext.Provider
      value={{ addDeletedEvent, addDeletedEventId, isEventDeleted, tombstoneEpoch }}
    >
      {children}
    </DeletedEventContext.Provider>
  )
}
