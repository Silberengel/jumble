import type { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'
import type { ThreadPanelSource } from './types'
import type { ThreadPanelStoreSnapshot } from './types'

export type ThreadPanelIngress = {
  ingest: (events: Event[], source?: ThreadPanelSource) => void
  store: ThreadPanelStoreSnapshot
}

const ThreadPanelContext = createContext<ThreadPanelIngress | null>(null)

export function ThreadPanelProvider({
  value,
  children
}: {
  value: ThreadPanelIngress
  children: React.ReactNode
}) {
  return <ThreadPanelContext.Provider value={value}>{children}</ThreadPanelContext.Provider>
}

export function useThreadPanelIngressOptional(): ThreadPanelIngress | null {
  return useContext(ThreadPanelContext)
}
