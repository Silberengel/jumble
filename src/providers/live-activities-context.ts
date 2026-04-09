import type { TLiveActivityItem } from '@/lib/live-activities'
import { createContext } from 'react'

export type LiveActivitiesContextValue = {
  items: TLiveActivityItem[]
  loading: boolean
}

export const LiveActivitiesContext = createContext<LiveActivitiesContextValue | undefined>(undefined)
