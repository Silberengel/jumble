import type { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'
import type { ThreadPanelSource } from './types'

export type ThreadPanelIngestFn = (events: Event[], source?: ThreadPanelSource) => void

const ThreadPanelIngestContext = createContext<ThreadPanelIngestFn | null>(null)

/** Stable ingest callback — does not change when the panel store grows. */
export function ThreadPanelProvider({
  ingest,
  children
}: {
  ingest: ThreadPanelIngestFn
  children: React.ReactNode
}) {
  return (
    <ThreadPanelIngestContext.Provider value={ingest}>{children}</ThreadPanelIngestContext.Provider>
  )
}

export function useThreadPanelIngestOptional(): ThreadPanelIngestFn | null {
  return useContext(ThreadPanelIngestContext)
}

/** @deprecated Prefer {@link useThreadPanelIngestOptional} — store is not exposed via context. */
export function useThreadPanelIngressOptional(): { ingest: ThreadPanelIngestFn } | null {
  const ingest = useThreadPanelIngestOptional()
  return ingest ? { ingest } : null
}

export type ThreadPanelIngress = {
  ingest: ThreadPanelIngestFn
}
