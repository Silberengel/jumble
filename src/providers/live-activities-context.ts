import type { TLiveActivityItem } from '@/lib/live-activities'
import { createContext } from 'react'

export type LiveActivitiesContextValue = {
  items: TLiveActivityItem[]
  loading: boolean
  /** NIP-33 `kind:pubkey:d` addresses hidden from the carousel for this browser profile. */
  carouselHiddenAddresses: ReadonlySet<string>
  /** Toggle carousel visibility; persists to IndexedDB settings. */
  toggleLiveActivityCarouselHidden: (address: string) => Promise<void>
}

export const LiveActivitiesContext = createContext<LiveActivitiesContextValue | undefined>(undefined)
