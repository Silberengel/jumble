import { ExtendedKind, PROFILE_RELAY_URLS } from '@/constants'
import { getRelayListFromEvent, getHttpRelayListFromEvent } from '@/lib/event-metadata'
import { filterRelaysForEventPublish } from '@/lib/relay-publish-filter'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { collectWriteOutboxUrlsFromRelayList } from '@/lib/viewer-write-outboxes'
import logger from '@/lib/logger'
import { NEW_USER_HTTP_RELAY_URL } from '@/lib/new-user-template'
import { normalizeAnyRelayUrl } from '@/lib/url'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { TRelayList } from '@/types'
import { Event, kinds } from 'nostr-tools'

const BROADCAST_PENDING_KEY = 'imwaldNewUserTemplateBroadcastPending'

/** Space between replaceable template events — keeps relay publish rate limits from tripping. */
export const NEW_USER_TEMPLATE_BROADCAST_INTERVAL_MS = 20_000

/** Replaceable kinds created during one-click signup, in publish order. */
export const NEW_USER_TEMPLATE_BROADCAST_KINDS = [
  kinds.RelayList,
  ExtendedKind.HTTP_RELAY_LIST,
  ExtendedKind.FAVORITE_RELAYS,
  ExtendedKind.BLOCKED_RELAYS,
  kinds.Metadata,
  10015,
  kinds.Contacts,
  kinds.Mutelist
] as const

/** Relays that reject bursts or return HTTP 429 on connect during signup publish. */
const NEW_USER_TEMPLATE_PUBLISH_EXCLUDED = [
  'wss://relay.layer.systems',
  'wss://profiles.nostrver.se/'
] as const

/** Profile mirrors that only mirror kind 10002 (not kind 0 or other lists). */
const RELAY_LIST_ONLY_PROFILE_MIRRORS = ['wss://indexer.coracle.social/'] as const

const broadcastScheduledOrRunning = new Set<string>()

function templateRelayKey(url: string): string {
  return (normalizeAnyRelayUrl(url) || url).toLowerCase()
}

function isExcludedFromTemplateBroadcast(url: string): boolean {
  const key = templateRelayKey(url)
  return NEW_USER_TEMPLATE_PUBLISH_EXCLUDED.some((u) => templateRelayKey(u) === key)
}

function relayAllowsTemplateKind(url: string, kind: number): boolean {
  if (kind === kinds.RelayList) return true
  const key = templateRelayKey(url)
  return !RELAY_LIST_ONLY_PROFILE_MIRRORS.some((u) => templateRelayKey(u) === key)
}

function maxTemplatePublishRelays(kind: number): number {
  return kind === kinds.Metadata || kind === kinds.RelayList ? 4 : 3
}

/** Prefer mercury + stable write relays; profile index when kind allows. */
function prioritizeNewUserTemplateRelays(urls: string[]): string[] {
  const preferredOrder = [
    NEW_USER_HTTP_RELAY_URL,
    'wss://profiles.nostr1.com',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://thecitadel.nostr1.com'
  ]
  const byKey = new Map(urls.map((u) => [templateRelayKey(u), u]))
  const ordered: string[] = []
  for (const pref of preferredOrder) {
    const u = byKey.get(templateRelayKey(pref))
    if (u) {
      ordered.push(u)
      byKey.delete(templateRelayKey(u))
    }
  }
  for (const u of urls) {
    const k = templateRelayKey(u)
    if (byKey.has(k)) {
      ordered.push(u)
      byKey.delete(k)
    }
  }
  return ordered
}

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
  const filtered = filterRelaysForEventPublish(merged, kind)
    .filter((u) => !isExcludedFromTemplateBroadcast(u))
    .filter((u) => relayAllowsTemplateKind(u, kind))
  return prioritizeNewUserTemplateRelays(filtered).slice(0, maxTemplatePublishRelays(kind))
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
 * template events to their write outboxes and profile relays (spaced to avoid relay rate limits).
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
