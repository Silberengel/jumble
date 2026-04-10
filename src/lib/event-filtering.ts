import { Event } from 'nostr-tools'
import dayjs from 'dayjs'
import storage from '@/services/local-storage.service'

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
 * Check if an event is in quiet mode based on its quiet tag
 */
function isEventInQuietMode(event: Event): boolean {
  const quietTag = event.tags.find(tag => tag[0] === 'quiet')
  if (!quietTag || !quietTag[1]) {
    return false
  }

  const quietEndTime = parseInt(quietTag[1])
  if (isNaN(quietEndTime)) {
    return false
  }

  return dayjs().unix() < quietEndTime
}

/**
 * Check if interactions should be hidden for an event based on quiet settings
 */
export function shouldHideInteractions(event: Event): boolean {
  // Check global quiet mode first
  if (storage.getGlobalQuietMode()) {
    return true
  }

  // Check if we should respect quiet tags
  if (!storage.getRespectQuietTags()) {
    return false
  }

  // Check if the event is in quiet mode
  return isEventInQuietMode(event)
}

/**
 * Check if an event should be filtered out completely (expired)
 */
export function shouldFilterEvent(event: Event): boolean {
  return isEventExpired(event)
}
