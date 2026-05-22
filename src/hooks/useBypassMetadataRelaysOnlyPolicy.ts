import {
  enterMetadataRelaysOnlyBypass,
  leaveMetadataRelaysOnlyBypass
} from '@/lib/read-only-relay-personal'
import { useEffect } from 'react'

/** Disable “only my relay lists” while mounted (relay explore, search, relay directory). */
export function useBypassMetadataRelaysOnlyPolicy(): void {
  useEffect(() => {
    enterMetadataRelaysOnlyBypass()
    return () => leaveMetadataRelaysOnlyBypass()
  }, [])
}
