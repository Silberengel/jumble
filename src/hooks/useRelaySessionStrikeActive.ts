import { relaySessionStrikes } from '@/lib/relay-strikes'
import { useEffect, useMemo, useState } from 'react'

const COOLDOWN_TICK_MS = 5_000

/** Bump when session strike map changes or skip/cooldown windows may have expired. */
export function useRelaySessionStrikeRevision(): number {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const bump = () => setRevision((n) => n + 1)
    const unsub = relaySessionStrikes.subscribe(bump)
    const id = window.setInterval(bump, COOLDOWN_TICK_MS)
    return () => {
      unsub()
      window.clearInterval(id)
    }
  }, [])

  return revision
}

/**
 * True when the relay has session strike / cooldown state (failures, skip windows, rate limit).
 */
export function useRelaySessionStrikeActive(url: string | undefined): boolean {
  const revision = useRelaySessionStrikeRevision()
  return useMemo(
    () => (url ? relaySessionStrikes.isSessionStrikeActiveForUrl(url) : false),
    [url, revision]
  )
}
