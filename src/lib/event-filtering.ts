import { Event } from 'nostr-tools'
import dayjs from 'dayjs'

/**
 * Check if an event has expired based on its expiration tag
 */
function isEventExpired(event: Event): boolean {
  const expirationTag = event.tags.find(tag => tag[0] === 'expiration')
  if (!expirationTag || !expirationTag[1]) {
    return false
  }

  const expirationTime = parseInt(expirationTag[1])
  if (isNaN(expirationTime)) {
    return false
  }

  return dayjs().unix() > expirationTime
}

/**
 * Check if an event should be filtered out completely (expired)
 */
export function shouldFilterEvent(event: Event): boolean {
  return isEventExpired(event)
}
