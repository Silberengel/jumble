import { ExtendedKind, PROFILE_RELAY_URLS } from '@/constants'
import { getRelayListFromEvent, getHttpRelayListFromEvent } from '@/lib/event-metadata'
import { filterRelaysForEventPublish } from '@/lib/relay-publish-filter'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { collectWriteOutboxUrlsFromRelayList } from '@/lib/viewer-write-outboxes'
import logger from '@/lib/logger'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { TRelayList } from '@/types'
import { Event, kinds } from 'nostr-tools'

const BROADCAST_PENDING_KEY = 'imwaldNewUserTemplateBroadcastPending'

export const NEW_USER_TEMPLATE_BROADCAST_INTERVAL_MS = 5000

/** Replaceable kinds created during one-click signup, in publish order. */
export const NEW_USER_TEMPLATE_BROADCAST_KINDS = [
  kinds.RelayList,
  ExtendedKind.HTTP_RELAY_LIST,
  ExtendedKind.FAVORITE_RELAYS,
  kinds.Metadata,
  10015,
  kinds.Contacts,
  kinds.Mutelist
] as const

const broadcastScheduledOrRunning = new Set<string>()

export function markNewUserTemplateBroadcastPending(pubkey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(BROADCAST_PENDING_KEY, pubkey)
}

function consumeBroadcastPending(pubkey: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  if (sessionStorage.getItem(BROADCAST_PENDING_KEY) !== pubkey) return false
  sessionStorage.removeItem(BROADCAST_PENDING_KEY)
  return true
}

/** Write outboxes from the stored template plus profile index relays where the kind allows it. */
export function newUserTemplatePublishRelays(kind: number, relayList: TRelayList): string[] {
  const write = collectWriteOutboxUrlsFromRelayList(relayList)
  const merged =
    kind === kinds.Metadata || kind === kinds.RelayList
      ? dedupeNormalizeRelayUrlsOrdered([...write, ...PROFILE_RELAY_URLS])
      : write
  return filterRelaysForEventPublish(merged, kind)
}

async function loadRelayListForPublish(pubkey: string): Promise<TRelayList> {
  const peeked = await client.peekRelayListFromStorage(pubkey)
  if (peeked.write.length > 0 || peeked.httpWrite.length > 0) {
    return peeked
  }
  const [relayListEvent, httpRelayListEvent] = await Promise.all([
    indexedDb.getReplaceableEvent(pubkey, kinds.RelayList),
    indexedDb.getReplaceableEvent(pubkey, ExtendedKind.HTTP_RELAY_LIST)
  ])
  const emptyHttp = {
    httpRead: [] as string[],
    httpWrite: [] as string[],
    httpOriginalRelays: [] as TRelayList['httpOriginalRelays']
  }
  let base: TRelayList = relayListEvent
    ? getRelayListFromEvent(relayListEvent, [])
    : { write: [], read: [], originalRelays: [], ...emptyHttp }
  if (httpRelayListEvent) {
    const http = getHttpRelayListFromEvent(httpRelayListEvent, [])
    base = {
      ...base,
      httpRead: http.httpRead,
      httpWrite: http.httpWrite,
      httpOriginalRelays: http.httpOriginalRelays
    }
  }
  return base
}

async function broadcastNewUserTemplateFromStorage(pubkey: string): Promise<void> {
  const relayList = await loadRelayListForPublish(pubkey)
  for (let i = 0; i < NEW_USER_TEMPLATE_BROADCAST_KINDS.length; i++) {
    const kind = NEW_USER_TEMPLATE_BROADCAST_KINDS[i]
    const event = (await indexedDb.getReplaceableEvent(pubkey, kind)) as Event | undefined
    if (!event) continue
    const relays = newUserTemplatePublishRelays(kind, relayList)
    if (relays.length === 0) continue
    try {
      await client.publishEvent(relays, event, {
        skipOutboxRetry: true,
        publishBatchLabel: 'new user template broadcast'
      })
    } catch (error) {
      logger.warn('[newUserTemplateBroadcast] publish failed', { kind, error })
    }
    if (i < NEW_USER_TEMPLATE_BROADCAST_KINDS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, NEW_USER_TEMPLATE_BROADCAST_INTERVAL_MS))
    }
  }
}

/**
 * After the user dismisses the backup banner or leaves cache settings, broadcast locally stored
 * template events to their write outboxes and profile relays (5s between events).
 */
export function requestNewUserTemplateBroadcast(pubkey: string): void {
  if (!pubkey || broadcastScheduledOrRunning.has(pubkey)) return
  if (typeof sessionStorage === 'undefined') return
  if (sessionStorage.getItem(BROADCAST_PENDING_KEY) !== pubkey) return

  broadcastScheduledOrRunning.add(pubkey)
  void (async () => {
    try {
      if (!consumeBroadcastPending(pubkey)) return
      await broadcastNewUserTemplateFromStorage(pubkey)
    } catch (error) {
      logger.error('[newUserTemplateBroadcast] failed', { error })
    } finally {
      broadcastScheduledOrRunning.delete(pubkey)
    }
  })()
}
