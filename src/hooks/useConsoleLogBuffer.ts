import {
  getConsoleLogBuffer,
  subscribeConsoleLogBuffer,
  type ConsoleLogEntry
} from '@/lib/console-log-buffer'
import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  return subscribeConsoleLogBuffer(onStoreChange)
}

function getSnapshot(): ConsoleLogEntry[] {
  return getConsoleLogBuffer()
}

/** Live view of the global console log ring buffer (see Settings → Cache). */
export function useConsoleLogBuffer(): ConsoleLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
