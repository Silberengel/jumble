import { useContext } from 'react'
import { LiveActivitiesContext, type LiveActivitiesContextValue } from './live-activities-context'

export function useLiveActivities(): LiveActivitiesContextValue {
  const ctx = useContext(LiveActivitiesContext)
  if (!ctx) {
    throw new Error('useLiveActivities must be used within LiveActivitiesProvider')
  }
  return ctx
}

export function useLiveActivitiesOptional(): LiveActivitiesContextValue | undefined {
  return useContext(LiveActivitiesContext)
}
