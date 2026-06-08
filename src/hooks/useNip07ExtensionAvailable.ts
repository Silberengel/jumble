import {
  NIP07_INJECT_CHECK_INTERVAL_MS,
  NIP07_INJECT_MAX_ATTEMPTS
} from '@/providers/NostrProvider/nip-07.signer'
import { useEffect, useState } from 'react'

/**
 * True once a NIP-07 browser extension has injected `window.nostr`.
 * Polls briefly — mobile browsers often expose the API after first paint.
 */
export function useNip07ExtensionAvailable(): boolean {
  const [available, setAvailable] = useState(() => !!window.nostr)

  useEffect(() => {
    if (available) return

    let attempt = 0
    const id = window.setInterval(() => {
      if (window.nostr) {
        setAvailable(true)
        window.clearInterval(id)
        return
      }
      attempt += 1
      if (attempt >= NIP07_INJECT_MAX_ATTEMPTS) {
        window.clearInterval(id)
      }
    }, NIP07_INJECT_CHECK_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [available])

  return available
}
