import {
  getViewerPersonalRelayKeysRevision,
  VIEWER_PERSONAL_RELAY_KEYS_SYNCED_EVENT
} from '@/lib/read-only-relay-personal'
import { useEffect, useState } from 'react'

/** Bumps when viewer NIP-65 / 10432 / 10243 / favorites personal-relay keys sync (timeline re-subscribe). */
export function useViewerPersonalRelayKeysRevision(): number {
  const [revision, setRevision] = useState(() => getViewerPersonalRelayKeysRevision())
  useEffect(() => {
    const onSynced = () => {
      setRevision(getViewerPersonalRelayKeysRevision())
    }
    window.addEventListener(VIEWER_PERSONAL_RELAY_KEYS_SYNCED_EVENT, onSynced)
    return () => {
      window.removeEventListener(VIEWER_PERSONAL_RELAY_KEYS_SYNCED_EVENT, onSynced)
    }
  }, [])
  return revision
}
