import activityTrace from '@/lib/activity-trace'
import { useSyncExternalStore } from 'react'

export function useActivityTraceEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => activityTrace.subscribeEnabled(listener),
    () => activityTrace.isEnabled(),
    () => false
  )
}

export function setActivityTraceEnabled(enabled: boolean, verbose = true): void {
  if (enabled) {
    activityTrace.enable({ verbose, debug: verbose })
  } else {
    activityTrace.disable()
  }
}
