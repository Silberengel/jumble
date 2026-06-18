import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Event } from 'nostr-tools'
import { createThreadPanelStore, ingestThreadPanelEvents } from './ThreadPanelStore'
import type { ThreadPanelSource, ThreadPanelStoreSnapshot } from './types'
import type { ThreadPanelIngress } from './ThreadPanelContext'

/** Per-open-note store + unified ingest for the thread panel. */
export function useThreadPanelStore(event: Event): {
  panelStore: ThreadPanelStoreSnapshot
  repliesMap: ThreadPanelStoreSnapshot['index']
  ingest: (events: Event[], source?: ThreadPanelSource) => void
  addReplies: (events: Event[], source?: ThreadPanelSource) => void
  panelIngress: ThreadPanelIngress
} {
  const [panelStore, setPanelStore] = useState<ThreadPanelStoreSnapshot>(() => createThreadPanelStore())
  const repliesMap = panelStore.index

  useEffect(() => {
    setPanelStore(createThreadPanelStore())
  }, [event.id])

  const ingest = useCallback(
    (events: Event[], source: ThreadPanelSource = 'live') => {
      if (events.length === 0) return
      setPanelStore((prev) =>
        ingestThreadPanelEvents(prev, events, source, {
          statsRootEvent: event,
          statsRootPubkey: event.pubkey
        })
      )
    },
    [event]
  )

  const addReplies = useCallback(
    (events: Event[], source: ThreadPanelSource = 'relay') => {
      ingest(events, source)
    },
    [ingest]
  )

  const panelIngress = useMemo(
    () => ({ ingest, store: panelStore }),
    [ingest, panelStore]
  )

  return { panelStore, repliesMap, ingest, addReplies, panelIngress }
}
