import type { AbstractRelay } from 'nostr-tools/abstract-relay'

const patched = new WeakSet<object>()

/**
 * One-time patch: forward every relay NOTICE to the app (strikes / rate-limit cooldown / logs).
 * Safe to call on every ensureRelay; only the first patch per relay instance applies.
 */
export function patchRelayNoticeForFetchFailures(
  relay: AbstractRelay,
  relayKey: string,
  onNotice?: (relayKey: string, noticeMessage: string) => void
): void {
  if (!onNotice || patched.has(relay as object)) return
  patched.add(relay as object)
  const previous = relay.onnotice.bind(relay)
  relay.onnotice = (msg: string) => {
    if (typeof msg === 'string' && msg.trim()) {
      try {
        onNotice(relayKey, msg)
      } catch {
        /* ignore */
      }
    }
    previous(msg)
  }
}
