import { enterSingleRelayExplicitBrowse, leaveSingleRelayExplicitBrowse } from '@/lib/read-only-relay-personal'
import { useEffect } from 'react'

/** Relay detail feed: connect to the page relay even if it is not on the viewer's personal lists. */
export function useRelayPageFeedPolicy(): void {
  useEffect(() => {
    enterSingleRelayExplicitBrowse()
    return () => leaveSingleRelayExplicitBrowse()
  }, [])
}
