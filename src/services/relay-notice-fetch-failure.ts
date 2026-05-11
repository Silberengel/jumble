import type { AbstractRelay } from 'nostr-tools/abstract-relay'

const patched = new WeakSet<object>()

/** NOTICE bodies that indicate the relay backend failed to serve the REQ. */
const FAILED_FETCH_EVENTS = /failed to fetch events/i

/**
 * One-time patch: relay NOTICE "failed to fetch events" -> diagnostic callback.
 * Safe to call on every ensureRelay; only the first patch per relay instance applies.
 */
export function patchRelayNoticeForFetchFailures(
  relay: AbstractRelay,
  relayKey: string,
  onFailure?: (normalizedUrl: string, noticeMessage: string) => void
): void {
  if (!onFailure || patched.has(relay as object)) return
  patched.add(relay as object)
  const previous = relay.onnotice.bind(relay)
  relay.onnotice = (msg: string) => {
    if (typeof msg === 'string' && FAILED_FETCH_EVENTS.test(msg)) {
      try {
        onFailure(relayKey, msg)
      } catch {
        /* ignore */
      }
    }
    previous(msg)
  }
}
