/**
 * Navigation Event Store
 * Temporarily stores events when navigating to avoid re-fetching
 */
import { getNoteBech32Id } from '@/lib/event'
import { Event, nip19 } from 'nostr-tools'

/** URL paths use bech32 (nevent1…, naddr1…); lookups must match the `id` passed to `useFetchEvent`. */
export function candidateKeysForNoteUrlId(eventId: string): string[] {
  const trimmed = eventId.trim()
  if (!trimmed) return []
  const keys = [trimmed]
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return keys
  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === 'nevent') {
      keys.push(decoded.data.id)
    } else if (decoded.type === 'note') {
      keys.push(decoded.data)
    } else if (decoded.type === 'naddr') {
      keys.push(
        `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier ?? ''}`
      )
    }
  } catch {
    /* not bech32 */
  }
  return keys
}

class NavigationEventStore {
  private eventMap = new Map<string, Event>()

  /**
   * Store an event for navigation (hex id + bech32 forms + optional URL segment from {@link parseNoteUrl}).
   */
  setEvent(event: Event, navigatedNoteId?: string): void {
    const keys = new Set<string>([event.id.toLowerCase()])
    if (navigatedNoteId?.trim()) {
      for (const k of candidateKeysForNoteUrlId(navigatedNoteId)) {
        keys.add(k)
      }
    }
    try {
      const urlId = getNoteBech32Id(event)
      for (const k of candidateKeysForNoteUrlId(urlId)) {
        keys.add(k)
      }
    } catch {
      /* ignore */
    }
    for (const key of keys) {
      if (key) this.eventMap.set(key, event)
    }
  }

  /**
   * Read an event by ID without removing it (safe for React Strict Mode / effect re-runs).
   * Cleared on the next {@link clear} (e.g. when navigating to another note).
   */
  peekEvent(eventId: string): Event | undefined {
    for (const key of candidateKeysForNoteUrlId(eventId)) {
      const event = this.eventMap.get(key)
      if (event) return event
    }
    return undefined
  }

  /**
   * Check if an event exists without removing it
   */
  hasEvent(eventId: string): boolean {
    return candidateKeysForNoteUrlId(eventId).some((k) => this.eventMap.has(k))
  }

  /**
   * Clear all stored events (cleanup)
   */
  clear(): void {
    this.eventMap.clear()
  }
}

export const navigationEventStore = new NavigationEventStore()
