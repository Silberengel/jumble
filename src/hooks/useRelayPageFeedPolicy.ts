import {
  enterMetadataRelaysOnlyBypass,
  enterSingleRelayExplicitBrowse,
  leaveMetadataRelaysOnlyBypass,
  leaveSingleRelayExplicitBrowse
} from '@/lib/read-only-relay-personal'
import { useEffect } from 'react'

/** Relay detail feed: bypass metadata-only narrowing, user blocks, and session strikes for the page relay. */
export function useRelayPageFeedPolicy(): void {
  useEffect(() => {
    enterMetadataRelaysOnlyBypass()
    enterSingleRelayExplicitBrowse()
    return () => {
      leaveSingleRelayExplicitBrowse()
      leaveMetadataRelaysOnlyBypass()
    }
  }, [])
}
