/**
 * Fetch GIFs from Nostr: kind 1063 (NIP-94 file metadata) and from kind 1 / 1111 (notes/comments that contain GIF URLs).
 * Same approach as aitherboard for 1063; for 1/1111 we parse content and tags for .gif URLs.
 */

import {
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  GIF_RELAY_URLS
} from '@/constants'
import { eventMatchesNip50LocalFullTextQuery } from '@/lib/nip50-local-text-match'
import { normalizeUrl } from '@/lib/url'
import { kinds } from 'nostr-tools'
import type { Event as NEvent } from 'nostr-tools'
import { queryService } from './client.service'
import indexedDb from './indexed-db.service'

export interface GifMetadata {
  url: string
  fallbackUrl?: string
  sha256?: string
  mimeType?: string
  width?: number
  height?: number
  /** Human-readable label from kind 1063 `content`, `alt`, or extra `#t` tags (for search / cache). */
  description?: string
  /** Nostr kind of the event this row was parsed from (1063 vs note vs comment). */
  sourceKind: number
  eventId: string
  pubkey: string
  createdAt: number
}

/** True if the GIF bytes are served from nostr.build (or a subdomain). */
export function isNostrBuildHostedUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'nostr.build' || h.endsWith('.nostr.build')
  } catch {
    return false
  }
}

/**
 * External GIF from a note/comment: offer “archive” = publish kind 1063 + insert.
 * Not shown for 1063 events or when the URL already points at nostr.build.
 */
export function gifShouldOfferNip94Archive(gif: GifMetadata): boolean {
  if (gif.sourceKind === ExtendedKind.FILE_METADATA) return false
  if (isNostrBuildHostedUrl(gif.url)) return false
  if (gif.fallbackUrl?.trim() && isNostrBuildHostedUrl(gif.fallbackUrl.trim())) return false
  return true
}

/** Own GIFs/memes first, then newest first (picker grids). */
export function sortGifsForPicker(gifs: GifMetadata[], userPubkey: string | null): GifMetadata[] {
  const u = userPubkey?.toLowerCase() ?? ''
  return [...gifs].sort((a, b) => {
    if (u) {
      const aOwn = a.pubkey.toLowerCase() === u ? 1 : 0
      const bOwn = b.pubkey.toLowerCase() === u ? 1 : 0
      if (aOwn !== bOwn) return bOwn - aOwn
    }
    return b.createdAt - a.createdAt
  })
}

/** Normalize a GIF URL for deduplication: strip fragment and query, lowercase. */
function normalizeGifUrl(url: string): string {
  try {
    const withoutFragment = url.split('#')[0].trim()
    const withoutQuery = withoutFragment.split('?')[0].trim()
    const lower = withoutQuery.toLowerCase()
    return lower || url
  } catch {
    return url
  }
}

/** Priority for deduplication: higher wins. Own event > other's event > non-event. */
const GIF_PRIORITY = {
  OWN_EVENT: 2,
  OTHER_EVENT: 1,
  NON_EVENT: 0
} as const

/** `#t` tokens derived from a user description (always includes literal `gif` separately). */
function topicTagsFromGifDescription(description: string): string[] {
  const seen = new Set<string>(['gif'])
  const out: string[] = []
  for (const raw of description.split(/[\s,]+/)) {
    const token = raw.replace(/^#+/, '').trim().toLowerCase()
    if (token.length >= 2 && !seen.has(token)) {
      seen.add(token)
      out.push(token)
    }
  }
  return out
}

/** Append NIP-94 `alt` + searchable `#t` tags for a GIF description onto kind 1063 tag lists. */
export function appendGifDescriptionTo1063Tags(tags: string[][], description?: string): void {
  const desc = description?.trim() ?? ''
  if (!desc) return
  tags.push(['alt', desc])
  for (const topic of topicTagsFromGifDescription(desc)) {
    tags.push(['t', topic])
  }
}

/** Kind 1063 publish draft for a remote GIF URL (grid pick, paste, archive). */
export function buildKind1063GifPublishDraft(url: string, description?: string) {
  const desc = description?.trim() ?? ''
  const tags: string[][] = [
    ['url', url],
    ['m', 'image/gif'],
    ['t', 'gif']
  ]
  appendGifDescriptionTo1063Tags(tags, desc)
  return {
    kind: ExtendedKind.FILE_METADATA,
    content: desc,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  }
}

function descriptionFromGifEvent(event: NEvent): string | undefined {
  const alt = event.tags.find((t) => t[0] === 'alt' && t[1]?.trim())?.[1]?.trim()
  if (alt) return alt
  const content = event.content?.trim()
  if (content && !/^https?:\/\//i.test(content)) return content
  const topics = event.tags
    .filter((t) => t[0] === 't' && t[1]?.trim() && t[1].trim().toLowerCase() !== 'gif')
    .map((t) => t[1]!.trim())
  if (topics.length > 0) return topics.join(' ')
  return undefined
}

function parseGifFromEvent(event: NEvent): GifMetadata | null {
  let url: string | undefined
  let mimeType: string | undefined
  let width: number | undefined
  let height: number | undefined
  let fallbackUrl: string | undefined
  let sha256: string | undefined

  // imeta tags (NIP-92): accept url when it contains .gif or when m is image/gif
  const imetaTags = event.tags.filter((t) => t[0] === 'imeta')
  for (const imetaTag of imetaTags) {
    const mimeField = imetaTag.find((f) => f?.startsWith('m '))
    const imetaMime = mimeField?.substring(2).trim()
    const isGifMime = imetaMime === 'image/gif'
    for (let i = 1; i < imetaTag.length; i++) {
      const field = imetaTag[i]
      if (field?.startsWith('url ')) {
        const candidateUrl = field.substring(4).trim()
        if (!candidateUrl) continue
        const urlHasGif = candidateUrl.toLowerCase().includes('.gif')
        if (urlHasGif || isGifMime) {
          url = candidateUrl
          if (mimeField) mimeType = imetaMime
          const dimField = imetaTag.find((f) => f?.startsWith('dim '))
          if (dimField) {
            const dims = dimField.substring(4).trim().split('x')
            if (dims.length >= 2) {
              width = parseInt(dims[0], 10)
              height = parseInt(dims[1], 10)
            }
          }
          break
        }
      }
    }
    if (url) break
  }

  // file tags (NIP-94 kind 1063)
  if (!url) {
    const fileTags = event.tags.filter((t) => t[0] === 'file' && t[1])
    for (const fileTag of fileTags) {
      const candidateUrl = fileTag[1]
      const candidateMimeType = fileTag[2]
      const isGifUrl =
        candidateUrl &&
        (candidateUrl.toLowerCase().includes('.gif') ||
          candidateUrl.toLowerCase().startsWith('data:image/gif') ||
          candidateMimeType === 'image/gif')
      if (isGifUrl) {
        url = candidateUrl
        if (candidateMimeType) mimeType = candidateMimeType
        break
      }
    }
  }

  // image tags
  if (!url) {
    const imageTags = event.tags.filter((t) => t[0] === 'image' && t[1])
    for (const imageTag of imageTags) {
      const candidateUrl = imageTag[1]
      if (candidateUrl && candidateUrl.toLowerCase().includes('.gif')) {
        url = candidateUrl
        break
      }
    }
  }

  // url tag (accept any URL; isGif check below uses mime from 'm' tag if URL has no .gif)
  if (!url) {
    const urlTag = event.tags.find((t) => t[0] === 'url' && t[1])
    if (urlTag?.[1]) {
      url = urlTag[1]
      if (!mimeType) {
        const mTag = event.tags.find((t) => t[0] === 'm' && t[1])
        mimeType = mTag?.[1]
      }
    }
  }

  // content: markdown image or plain URL
  if (!url) {
    const markdownMatch = event.content.match(
      /!\[[^\]]*\]\((https?:\/\/[^\s<>"')]+\.gif[^\s<>"')]*)\)/i
    )
    if (markdownMatch) {
      url = markdownMatch[1]
    } else {
      const urlMatch = event.content.match(/https?:\/\/[^\s<>"']+\.gif(\?[^\s<>"']*)?/i)
      if (urlMatch) url = urlMatch[0]
    }
  }

  if (!url) return null

  const urlLower = url.toLowerCase()
  const isGif =
    mimeType === 'image/gif' ||
    urlLower.endsWith('.gif') ||
    urlLower.includes('.gif?') ||
    urlLower.includes('/gif') ||
    urlLower.includes('gif')
  if (!isGif) return null

  if (!mimeType) {
    const mimeTag = event.tags.find((t) => t[0] === 'm' && t[1])
    mimeType = mimeTag?.[1] || 'image/gif'
  }

  if (!width || !height) {
    const dimTag = event.tags.find((t) => t[0] === 'dim' && t[1])
    if (dimTag?.[1]) {
      const dims = dimTag[1].split('x')
      if (dims.length >= 2) {
        width = parseInt(dims[0], 10)
        height = parseInt(dims[1], 10)
      }
    }
  }

  const sha256Tag = event.tags.find((t) => t[0] === 'x' && t[1])
  sha256 = sha256Tag?.[1]
  const fallbackTag = event.tags.find((t) => t[0] === 'fallback' && t[1])
  fallbackUrl = fallbackTag?.[1]
  const description = descriptionFromGifEvent(event)

  return {
    url,
    fallbackUrl,
    sha256,
    mimeType: mimeType || 'image/gif',
    width,
    height,
    description,
    sourceKind: event.kind,
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at
  }
}

const CACHE_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour; short enough to stay fresh, long enough to survive browser restarts
const MIN_GIF_CACHE_ENTRIES = 8
const GIF_CACHE_CAP = 80

/**
 * High `limit` values otherwise trigger implicit feed first-relay grace (~2s) and return before
 * GIF-heavy relays (e.g. thecitadel) finish. Picker loads must also be foreground so navigation
 * does not abort them via {@link QueryService.interruptBackgroundQueries}.
 */
const GIF_FETCH_OPTS = {
  eoseTimeout: 20_000,
  globalTimeout: 28_000,
  firstRelayResultGraceMs: false as const,
  foreground: true as const
}

/** Session-start cache preload — low priority but must finish (not aborted on navigation). */
const GIF_PRELOAD_FETCH_OPTS = {
  eoseTimeout: 18_000,
  globalTimeout: 26_000,
  firstRelayResultGraceMs: false as const,
  backgroundInterruptImmune: true as const
}

let gifOutboxPreloadInFlight: Promise<void> | null = null

/** Ensured on the kind 1063 (NIP-94) relay set even if absent from merged read lists. */
const THECITADEL_FOR_GIF_METADATA =
  normalizeUrl('wss://thecitadel.nostr1.com') || 'wss://thecitadel.nostr1.com'

function dedupeRelayUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  return urls
    .map((u) => normalizeUrl(u) || u)
    .filter(Boolean)
    .filter((u) => {
      const n = u.toLowerCase()
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
}

function normalizeCachedGif(g: GifMetadata & { sourceKind?: number }): GifMetadata {
  return {
    ...g,
    sourceKind:
      typeof g.sourceKind === 'number' ? g.sourceKind : ExtendedKind.FILE_METADATA
  }
}

export function gifMetadataMatchesSearch(gif: GifMetadata, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    gif.description,
    gif.url,
    gif.fallbackUrl,
    gif.eventId,
    gif.pubkey,
    String(gif.sourceKind)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

/** Full IndexedDB GIF pool for local search (up to {@link GIF_CACHE_CAP}). */
export async function getAllCachedGifsForSearch(
  userPubkey: string | null = null
): Promise<GifMetadata[]> {
  try {
    const cached = await indexedDb.getGifCache()
    if (!cached?.gifs?.length) return []
    const normalized = cached.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
    return sortGifsForPicker(normalized, userPubkey)
  } catch {
    return []
  }
}

function mergeGifEventsIntoMap(
  events: readonly NEvent[],
  byUrl: Map<string, { gif: GifMetadata; priority: number }>,
  searchQuery: string | undefined,
  userPubkey: string | null
): void {
  for (const event of events) {
    const gif = parseGifFromEvent(event)
    if (!gif) continue
    if (searchQuery && !eventMatchesNip50LocalFullTextQuery(event, searchQuery)) continue

    const key = normalizeGifUrl(gif.url)
    const priority =
      userPubkey && event.pubkey === userPubkey ? GIF_PRIORITY.OWN_EVENT : GIF_PRIORITY.OTHER_EVENT
    const existing = byUrl.get(key)
    if (!existing || priority > existing.priority) {
      byUrl.set(key, { gif, priority })
    }
  }
}

export async function mergeGifsIntoIdbCache(incoming: GifMetadata[]): Promise<void> {
  if (incoming.length === 0) return
  const row = await indexedDb.getGifCache()
  const byKey = new Map<string, GifMetadata>()
  for (const g of row?.gifs ?? []) {
    const meta = normalizeCachedGif(g as GifMetadata)
    if (meta.url) byKey.set(normalizeGifUrl(meta.url), meta)
  }
  for (const g of incoming) {
    if (g.url) byKey.set(normalizeGifUrl(g.url), g)
  }
  const merged = [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, GIF_CACHE_CAP)
  await indexedDb.setGifCache(merged, Date.now())
}

function gifRelayUrlsForFetch(extraReadRelayUrls: readonly string[]): {
  relays1063: string[]
  relaysNotes: string[]
} {
  const dedupedUrls = dedupeRelayUrls([
    ...GIF_RELAY_URLS,
    ...FAST_READ_RELAY_URLS,
    ...extraReadRelayUrls
  ])
  const relays1063 = dedupedUrls.some(
    (u) => (normalizeUrl(u) || u).toLowerCase() === THECITADEL_FOR_GIF_METADATA.toLowerCase()
  )
    ? dedupedUrls
    : [...dedupedUrls, THECITADEL_FOR_GIF_METADATA]
  return { relays1063, relaysNotes: dedupedUrls }
}

function gifsFromEvents(
  events1063: readonly NEvent[],
  eventsNotes: readonly NEvent[],
  userPubkey: string | null
): GifMetadata[] {
  const byUrl = new Map<string, { gif: GifMetadata; priority: number }>()
  mergeGifEventsIntoMap(events1063, byUrl, undefined, userPubkey)
  mergeGifEventsIntoMap(eventsNotes, byUrl, undefined, userPubkey)
  return sortGifsForPicker(
    Array.from(byUrl.values()).map((v) => v.gif),
    userPubkey
  )
}

/**
 * Background session preload into IndexedDB: kind 1063 on GIF relays + thecitadel, kind 1/1111 on the
 * broad list, merged with the viewer's inboxes/outboxes when provided.
 */
export async function preloadGifsIntoIdbCache(
  userPubkey: string | null,
  extraReadRelayUrls: readonly string[] = []
): Promise<void> {
  const cached = await indexedDb.getGifCache()
  if (
    cached &&
    cached.gifs.length >= MIN_GIF_CACHE_ENTRIES &&
    Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS
  ) {
    return
  }

  if (gifOutboxPreloadInFlight) {
    await gifOutboxPreloadInFlight
    return
  }

  gifOutboxPreloadInFlight = (async () => {
    const { relays1063, relaysNotes } = gifRelayUrlsForFetch(extraReadRelayUrls)

    const [events1063, eventsNotes] = await Promise.all([
      queryService.fetchEvents(
        relays1063,
        { kinds: [ExtendedKind.FILE_METADATA], limit: 400 },
        GIF_PRELOAD_FETCH_OPTS
      ),
      queryService.fetchEvents(
        relaysNotes,
        {
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT],
          limit: 500
        },
        GIF_PRELOAD_FETCH_OPTS
      )
    ])

    const gifs = gifsFromEvents(events1063, eventsNotes, userPubkey).slice(0, GIF_CACHE_CAP)
    if (gifs.length > 0) {
      await mergeGifsIntoIdbCache(gifs)
    }
  })()

  try {
    await gifOutboxPreloadInFlight
  } finally {
    gifOutboxPreloadInFlight = null
  }
}

/** @deprecated Use {@link preloadGifsIntoIdbCache}. Kept for call-site compatibility. */
export async function preloadGifsFromUserOutboxes(
  outboxRelayUrls: readonly string[],
  userPubkey: string | null,
  _signal?: AbortSignal
): Promise<void> {
  return preloadGifsIntoIdbCache(userPubkey, outboxRelayUrls)
}

/**
 * Fetch GIFs from Nostr kind 1063 (NIP-94) events on GIF relays.
 * Deduplicates by normalized URL; when the same GIF appears from multiple sources,
 * keeps: 1) user's own events, 2) other users' events, 3) non-event sources.
 * @param extraReadRelayUrls - Logged-in user's read relays (inboxes) and local relays to include when fetching.
 * @param userPubkey - Current user's pubkey; entries from this pubkey get highest priority when deduping.
 */
export async function fetchGifs(
  limit: number = 50,
  forceRefresh: boolean = false,
  extraReadRelayUrls: string[] = [],
  userPubkey: string | null = null
): Promise<GifMetadata[]> {
  if (!forceRefresh) {
    const cached = await indexedDb.getGifCache()
    if (
      cached &&
      cached.gifs.length >= MIN_GIF_CACHE_ENTRIES &&
      Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS
    ) {
      const normalized = cached.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
      return sortGifsForPicker(normalized, userPubkey).slice(0, limit)
    }
  }

  let staleFallback: GifMetadata[] | null = null
  const row = await indexedDb.getGifCache()
  if (row?.gifs?.length) {
    staleFallback = row.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
  }

  const limit1063 = Math.max(limit * 15, 400)
  const limitNotes = Math.max(limit * 15, 500)

  const { relays1063, relaysNotes: dedupedUrls } = gifRelayUrlsForFetch(extraReadRelayUrls)

  let events1063: NEvent[] = []
  let eventsNotes: NEvent[] = []

  try {
    ;[events1063, eventsNotes] = await Promise.all([
      queryService.fetchEvents(
        relays1063,
        { kinds: [ExtendedKind.FILE_METADATA], limit: limit1063 },
        GIF_FETCH_OPTS
      ),
      queryService.fetchEvents(
        dedupedUrls,
        {
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT],
          limit: limitNotes
        },
        GIF_FETCH_OPTS
      )
    ])
  } catch (err) {
    if (staleFallback?.length) {
      return sortGifsForPicker(staleFallback, userPubkey).slice(0, limit)
    }
    throw err
  }

  const byUrl = new Map<string, { gif: GifMetadata; priority: number }>()
  mergeGifEventsIntoMap(events1063, byUrl, undefined, userPubkey)
  mergeGifEventsIntoMap(eventsNotes, byUrl, undefined, userPubkey)

  const allGifs = sortGifsForPicker(
    Array.from(byUrl.values()).map((v) => v.gif),
    userPubkey
  )
  let result = allGifs.slice(0, limit)

  if (result.length === 0 && staleFallback?.length) {
    result = sortGifsForPicker(staleFallback, userPubkey).slice(0, limit)
  }

  if (allGifs.length > 0) {
    await mergeGifsIntoIdbCache(allGifs.slice(0, GIF_CACHE_CAP))
  }

  return result
}

/**
 * Return whatever is currently in the IndexedDB GIF cache without fetching from relays.
 * Used to seed the picker immediately on open; the caller can then trigger a background refresh.
 */
export async function getCachedGifs(userPubkey: string | null = null): Promise<GifMetadata[]> {
  const all = await getAllCachedGifsForSearch(userPubkey)
  return all.slice(0, 50)
}

/** Instant local search over the IndexedDB GIF cache (no relay round-trip). */
export async function searchGifs(
  query: string,
  limit: number = 50,
  _forceRefresh: boolean = false,
  _extraReadRelayUrls: string[] = [],
  userPubkey: string | null = null
): Promise<GifMetadata[]> {
  const q = query.trim()
  if (!q) return getCachedGifs(userPubkey)
  const pool = await getAllCachedGifsForSearch(userPubkey)
  return pool.filter((g) => gifMetadataMatchesSearch(g, q)).slice(0, limit)
}
