import { getEmojisAndEmojiSetsFromEvent, getEmojisFromEvent } from '@/lib/event-metadata'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { TEmoji } from '@/types'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

function addEmojis(map: Map<string, TEmoji>, list: TEmoji[]) {
  for (const e of list) {
    const sc = e.shortcode?.trim()
    const url = e.url?.trim()
    if (sc && url) map.set(sc, { shortcode: sc, url })
  }
}

async function collectAuthorEmojiEventsFromIndexedDb(pk: string): Promise<Event[]> {
  const [idbMeta, idbList, idbSets] = await Promise.all([
    indexedDb.getReplaceableEvent(pk, kinds.Metadata).catch(() => null),
    indexedDb.getReplaceableEvent(pk, kinds.UserEmojiList).catch(() => null),
    indexedDb.getEmojiSetEventsForPubkey(pk).catch(() => [] as Event[])
  ])
  const merged: Event[] = []
  const pushIf = (ev: Event | null | undefined) => {
    if (ev?.id) merged.push(ev)
  }
  pushIf(idbMeta ?? undefined)
  pushIf(idbList ?? undefined)
  for (const ev of idbSets) pushIf(ev)
  return merged
}

/**
 * NIP-30 custom emoji defined by an author: kind 0 `emoji` tags, kind 10030 list (+ `a` → 30030),
 * and kind 30030 packs (aligned with the custom emoji picker’s inventory fetch).
 */
async function emojiInfosFromAuthorEvents(events: Event[], pk: string): Promise<TEmoji[]> {
  const byShortcode = new Map<string, TEmoji>()

  const latestOfKind = (kind: number): Event | undefined =>
    events
      .filter((e) => e.kind === kind && e.pubkey.trim().toLowerCase() === pk)
      .sort((a, b) => b.created_at - a.created_at)[0]

  const meta = latestOfKind(kinds.Metadata)
  if (meta) addEmojis(byShortcode, getEmojisFromEvent(meta))

  const latestList = latestOfKind(kinds.UserEmojiList)
  if (latestList) {
    const { emojis, emojiSetPointers } = getEmojisAndEmojiSetsFromEvent(latestList)
    addEmojis(byShortcode, emojis)
    const setEvents = await client.fetchEmojiSetEvents(emojiSetPointers)
    for (const se of setEvents) {
      if (se) addEmojis(byShortcode, getEmojisFromEvent(se))
    }
  }

  for (const ev of events) {
    if (ev.kind === kinds.Emojisets && ev.pubkey.trim().toLowerCase() === pk) {
      addEmojis(byShortcode, getEmojisFromEvent(ev))
    }
  }

  return [...byShortcode.values()]
}

async function loadAuthorNip30EmojiInfosUncached(pubkey: string): Promise<TEmoji[]> {
  const pk = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) return []

  const [remote, idbEvents] = await Promise.all([
    client.fetchAuthorEmojiInventory(pk).catch(() => [] as Event[]),
    collectAuthorEmojiEventsFromIndexedDb(pk)
  ])
  const merged: Event[] = [...remote]
  for (const ev of idbEvents) {
    if (ev?.id) merged.push(ev)
  }

  return emojiInfosFromAuthorEvents(merged, pk)
}

async function loadAuthorNip30FromIndexedDbUncached(pubkey: string): Promise<TEmoji[]> {
  const pk = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) return []
  const events = await collectAuthorEmojiEventsFromIndexedDb(pk)
  return emojiInfosFromAuthorEvents(events, pk)
}

const inflightAuthorEmoji = new Map<string, Promise<TEmoji[]>>()
const inflightAuthorEmojiIdb = new Map<string, Promise<TEmoji[]>>()

/** Shared author inventory so every mounted note row updates when NIP-30 emoji loads. */
const authorEmojiCache = new Map<string, TEmoji[]>()
const authorEmojiListeners = new Map<string, Set<() => void>>()

/** Stable empty snapshot for {@link useSyncExternalStore} (must not allocate `[]` per read). */
export const EMPTY_AUTHOR_NIP30_EMOJIS: readonly TEmoji[] = []

function authorEmojiListsEqual(a: readonly TEmoji[], b: readonly TEmoji[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].shortcode !== b[i].shortcode || a[i].url !== b[i].url) return false
  }
  return true
}

function publishAuthorEmojiCache(pk: string, infos: TEmoji[]) {
  if (infos.length === 0) return
  const prev = authorEmojiCache.get(pk)
  if (prev && authorEmojiListsEqual(prev, infos)) return
  authorEmojiCache.set(pk, infos)
  authorEmojiListeners.get(pk)?.forEach((fn) => fn())
}

export function getAuthorNip30EmojiCache(pubkey: string): readonly TEmoji[] {
  const pk = pubkey.trim().toLowerCase()
  return authorEmojiCache.get(pk) ?? EMPTY_AUTHOR_NIP30_EMOJIS
}

export function subscribeAuthorNip30EmojiCache(pubkey: string, onStoreChange: () => void): () => void {
  const pk = pubkey.trim().toLowerCase()
  let set = authorEmojiListeners.get(pk)
  if (!set) {
    set = new Set()
    authorEmojiListeners.set(pk, set)
  }
  set.add(onStoreChange)
  return () => {
    set!.delete(onStoreChange)
    if (set!.size === 0) authorEmojiListeners.delete(pk)
  }
}

/** Start NIP-30 emoji inventory loads for authors (deduped; updates {@link getAuthorNip30EmojiCache}). */
export function prefetchAuthorNip30EmojisForPubkeys(pubkeys: readonly string[]): void {
  for (const raw of pubkeys) {
    const pk = raw.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) continue
    if (authorEmojiCache.has(pk)) continue
    void fetchAuthorNip30EmojiInfosFromIndexedDb(pk).then((infos) => publishAuthorEmojiCache(pk, infos))
    void fetchAuthorNip30EmojiInfos(pk).then((infos) => publishAuthorEmojiCache(pk, infos))
  }
}

export function fetchAuthorNip30EmojiInfos(pubkey: string): Promise<TEmoji[]> {
  const pk = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) return Promise.resolve([])

  const cached = authorEmojiCache.get(pk)
  if (cached?.length) return Promise.resolve(cached)

  const existing = inflightAuthorEmoji.get(pk)
  if (existing) return existing

  const p = loadAuthorNip30EmojiInfosUncached(pk)
    .then((infos) => {
      publishAuthorEmojiCache(pk, infos)
      return infos
    })
    .finally(() => {
      if (inflightAuthorEmoji.get(pk) === p) inflightAuthorEmoji.delete(pk)
    })
  inflightAuthorEmoji.set(pk, p)
  return p
}

/** IndexedDB only — no relay inventory query; use with {@link fetchAuthorNip30EmojiInfos} for a full refresh. */
export function fetchAuthorNip30EmojiInfosFromIndexedDb(pubkey: string): Promise<TEmoji[]> {
  const pk = pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) return Promise.resolve([])

  const cached = authorEmojiCache.get(pk)
  if (cached?.length) return Promise.resolve(cached)

  const existing = inflightAuthorEmojiIdb.get(pk)
  if (existing) return existing

  const p = loadAuthorNip30FromIndexedDbUncached(pk)
    .then((infos) => {
      publishAuthorEmojiCache(pk, infos)
      return infos
    })
    .finally(() => {
      if (inflightAuthorEmojiIdb.get(pk) === p) inflightAuthorEmojiIdb.delete(pk)
    })
  inflightAuthorEmojiIdb.set(pk, p)
  return p
}
