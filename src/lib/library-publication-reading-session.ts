import { eventTagAddress } from '@/lib/publication-index'
import type { Event } from 'nostr-tools'

const SESSION_PREFIX = 'jumble-pub-reading:'

function sessionKeysForEvent(event: Event): string[] {
  const keys = [`${SESSION_PREFIX}${event.id}`]
  const addr = eventTagAddress(event)
  if (addr) keys.push(`${SESSION_PREFIX}${addr}`)
  return keys
}

export function markPublicationReadingStarted(event: Event): void {
  try {
    for (const key of sessionKeysForEvent(event)) {
      sessionStorage.setItem(key, '1')
    }
  } catch {
    /* sessionStorage unavailable */
  }
}

export function hasPublicationReadingStarted(event: Event): boolean {
  try {
    return sessionKeysForEvent(event).some((key) => sessionStorage.getItem(key) === '1')
  } catch {
    return false
  }
}
