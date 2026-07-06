/**
 * Fetch GIFs from Nostr: kind 1090 reaction clips (draft NIP, the preferred publish format),
 * kind 1063 (NIP-94 file metadata, legacy), and kind 1 / 1111 (notes/comments that contain GIF URLs).
 * Clips are content-addressed: the sha256 (`x`) of the media bytes is the identity; entries sharing
 * a hash are collapsed regardless of which URL serves the bytes.
 */

import {
  ExtendedKind,
  FAST_READ_RELAY_URLS,
  GIF_RELAY_URLS,
  METADATA_BATCH_AUTHORS_CHUNK
} from '@/constants'
import { eventMatchesNip50LocalFullTextQuery } from '@/lib/nip50-local-text-match'
import { grantRelayConnectionOperationScope } from '@/lib/read-only-relay-personal'
import { clipEmotionsFromTags } from '@/lib/reaction-clip'
import { chunkPubkeys, dedupeMediaPickerRelayUrls } from '@/lib/media-picker-relay-utils'
import { kinds, type Event as NEvent, type Filter } from 'nostr-tools'
import { queryService } from './client.service'
import indexedDb from './indexed-db.service'

export interface GifMetadata {
  url: string
  fallbackUrl?: string
  sha256?: string
  mimeType?: string
  width?: number
  height?: number
  /** Human-readable label from clip/1063 `content`, `alt`, or extra `#t` tags (for search / cache). */
  description?: string
  /** Reaction clip emotion labels (kind 1090, NIP-32 `emotion` namespace). */
  emotions?: string[]
  /** Nostr kind of the event this row was parsed from (1090 vs 1063 vs note vs comment). */
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
 * External GIF from a note/comment: offer “archive” = publish clip/1063 + insert.
 * Not shown for clip/1063 events or when the URL already points at nostr.build.
 */
export function gifShouldOfferNip94Archive(gif: GifMetadata): boolean {
  if (gif.sourceKind === ExtendedKind.REACTION_CLIP) return false
  if (gif.sourceKind === ExtendedKind.FILE_METADATA) return false
  if (isNostrBuildHostedUrl(gif.url)) return false
  if (gif.fallbackUrl?.trim() && isNostrBuildHostedUrl(gif.fallbackUrl.trim())) return false
  return true
}

/** Own GIFs, then follows, then others — newest first within each tier. */
export function sortGifsForPicker(
  gifs: GifMetadata[],
  userPubkey: string | null,
  followingPubkeys: readonly string[] = []
): GifMetadata[] {
  const u = userPubkey?.toLowerCase() ?? ''
  const followSet = new Set(followingPubkeys.map((p) => p.toLowerCase()).filter(Boolean))
  const tier = (g: GifMetadata): number => {
    const pk = g.pubkey.toLowerCase()
    if (u && pk === u) return 0
    if (followSet.has(pk)) return 1
    return 2
  }
  return [...gifs].sort((a, b) => {
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb
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

/** Higher wins when the same GIF URL appears from multiple Nostr events. */
function gifSourceKindPriority(sourceKind: number): number {
  if (sourceKind === ExtendedKind.REACTION_CLIP) return 4
  if (sourceKind === ExtendedKind.FILE_METADATA) return 3
  if (sourceKind === ExtendedKind.COMMENT) return 2
  if (sourceKind === kinds.ShortTextNote) return 1
  if (sourceKind === ExtendedKind.DISCUSSION) return 1
  return 0
}

function shouldPreferGif(candidate: GifMetadata, existing: GifMetadata): boolean {
  const cp = gifSourceKindPriority(candidate.sourceKind)
  const ep = gifSourceKindPriority(existing.sourceKind)
  if (cp !== ep) return cp > ep
  return candidate.createdAt > existing.createdAt
}

/**
 * One grid row per GIF; kind 1090 beats 1063 beats kind 1 / 1111 / 11 from notes.
 * First pass merges by URL, second pass merges by media sha256 (`x`) so the same
 * bytes served from different hosts collapse into one entry (content-addressed identity).
 */
export function dedupeGifsByUrl(gifs: readonly GifMetadata[]): GifMetadata[] {
  const byUrl = new Map<string, GifMetadata>()
  for (const gif of gifs) {
    if (!gif.url?.trim()) continue
    const key = normalizeGifUrl(gif.url)
    const existing = byUrl.get(key)
    if (!existing || shouldPreferGif(gif, existing)) {
      byUrl.set(key, gif)
    }
  }
  const out: GifMetadata[] = []
  const byHash = new Map<string, number>()
  for (const gif of byUrl.values()) {
    const hash = gif.sha256?.trim().toLowerCase()
    if (!hash) {
      out.push(gif)
      continue
    }
    const existingIdx = byHash.get(hash)
    if (existingIdx === undefined) {
      byHash.set(hash, out.length)
      out.push(gif)
    } else if (shouldPreferGif(gif, out[existingIdx])) {
      out[existingIdx] = gif
    }
  }
  return out
}

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
function appendGifDescriptionTo1063Tags(tags: string[][], description?: string): void {
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
  let sha256: string | undefined

  // Kind 1090 reaction clips declare animated media by definition (webp/gif/mp4) — no `.gif` heuristics.
  const isReactionClip = event.kind === ExtendedKind.REACTION_CLIP

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
        if (urlHasGif || isGifMime || isReactionClip) {
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
    isReactionClip ||
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
  if (!sha256) {
    // NIP-92 imeta may carry the hash even when no top-level `x` tag exists (e.g. notes).
    for (const imetaTag of imetaTags) {
      const xField = imetaTag.find((f) => f?.startsWith('x '))
      const candidate = xField?.substring(2).trim()
      if (candidate) {
        sha256 = candidate
        break
      }
    }
  }
  const fallbackTag = event.tags.find((t) => t[0] === 'fallback' && t[1])
  const fallbackUrl = fallbackTag?.[1]
  const description = descriptionFromGifEvent(event)
  const emotions = isReactionClip ? clipEmotionsFromTags(event.tags) : []

  return {
    url,
    fallbackUrl,
    sha256,
    mimeType: mimeType || 'image/gif',
    width,
    height,
    description,
    emotions: emotions.length > 0 ? emotions : undefined,
    sourceKind: event.kind,
    eventId: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at
  }
}

const CACHE_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const MIN_GIF_CACHE_ENTRIES = 1
/** Max kind-1063 rows from authors outside the viewer + follow graph. */
const GIF_OTHERS_1063_MAX = 500
/** Per-REQ page size when paginating author/global 1063 fetches on GIF relays. */
const GIF_1063_PAGE_LIMIT = 500
const GIF_AUTHOR_1063_MAX_PAGES = 40
/** When the 1063 pool is smaller than this, also scrape kind 1 / 1111 for GIF URLs. */
const GIF_NOTES_FALLBACK_THRESHOLD = 50
const GIF_NOTES_RELAY_LIMIT = 500

type GifFetchQueryOpts = {
  eoseTimeout: number
  globalTimeout: number
  firstRelayResultGraceMs: false
  foreground?: true
  backgroundInterruptImmune?: true
}

/**
 * High `limit` values otherwise trigger implicit feed first-relay grace (~2s) and return before
 * GIF-heavy relays finish. Picker loads must also be foreground so navigation does not abort them.
 */
const GIF_FETCH_OPTS: GifFetchQueryOpts = {
  eoseTimeout: 20_000,
  globalTimeout: 28_000,
  firstRelayResultGraceMs: false,
  foreground: true
}

/** Session-start cache preload — low priority but must finish (not aborted on navigation). */
const GIF_PRELOAD_FETCH_OPTS: GifFetchQueryOpts = {
  eoseTimeout: 18_000,
  globalTimeout: 26_000,
  firstRelayResultGraceMs: false,
  backgroundInterruptImmune: true
}

let gifOutboxPreloadInFlight: Promise<void> | null = null

/** Kind 1063 read/write targets — {@link GIF_RELAY_URLS} only. */
export function getGif1063RelayUrls(): string[] {
  return dedupeMediaPickerRelayUrls(GIF_RELAY_URLS)
}

function normalizeCachedGif(g: GifMetadata & { sourceKind?: number }): GifMetadata {
  return {
    ...g,
    sourceKind:
      typeof g.sourceKind === 'number' ? g.sourceKind : ExtendedKind.FILE_METADATA
  }
}

function mergeGifEventsIntoPool(
  events: readonly NEvent[],
  pool: Map<string, GifMetadata>,
  searchQuery?: string
): void {
  for (const event of events) {
    const gif = parseGifFromEvent(event)
    if (!gif) continue
    if (searchQuery && !eventMatchesNip50LocalFullTextQuery(event, searchQuery)) continue
    const key = normalizeGifUrl(gif.url)
    const existing = pool.get(key)
    if (!existing || shouldPreferGif(gif, existing)) {
      pool.set(key, gif)
    }
  }
}

async function fetch1063Paginated(
  relays: readonly string[],
  opts: GifFetchQueryOpts,
  filterBase: Omit<Filter, 'limit' | 'until'>,
  maxEvents?: number
): Promise<NEvent[]> {
  const out: NEvent[] = []
  const seen = new Set<string>()
  let until: number | undefined
  for (let page = 0; page < GIF_AUTHOR_1063_MAX_PAGES; page++) {
    const filter: Filter = {
      ...filterBase,
      kinds: [ExtendedKind.REACTION_CLIP, ExtendedKind.FILE_METADATA],
      limit: GIF_1063_PAGE_LIMIT,
      ...(until != null ? { until } : {})
    }
    const batch = await queryService.fetchEvents([...relays], filter, opts)
    if (batch.length === 0) break
    let oldest = until ?? Number.MAX_SAFE_INTEGER
    for (const event of batch) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
      out.push(event)
      if (event.created_at < oldest) oldest = event.created_at
      if (maxEvents != null && out.length >= maxEvents) return out
    }
    if (batch.length < GIF_1063_PAGE_LIMIT) break
    if (oldest <= 1) break
    until = oldest - 1
  }
  return out
}

function gifNoteFallbackRelays(extraReadRelayUrls: readonly string[]): string[] {
  return dedupeMediaPickerRelayUrls([...GIF_RELAY_URLS, ...FAST_READ_RELAY_URLS, ...extraReadRelayUrls])
}

export type LoadGifPoolOptions = {
  userPubkey: string | null
  followingPubkeys?: readonly string[]
  /** Viewer read inboxes — used only for kind 1 / 1111 fallback when the 1063 pool is tiny. */
  noteFallbackRelays?: readonly string[]
  fetchOpts?: GifFetchQueryOpts
}

/** Load picker pool: all viewer 1063 → all follows' 1063 → up to 500 other 1063; optional note scrape. */
export async function loadGifPoolFromRelays(options: LoadGifPoolOptions): Promise<GifMetadata[]> {
  const {
    userPubkey,
    followingPubkeys = [],
    noteFallbackRelays = [],
    fetchOpts = GIF_FETCH_OPTS
  } = options
  const relays1063 = getGif1063RelayUrls()
  const noteRelays =
    noteFallbackRelays.length > 0 ? gifNoteFallbackRelays(noteFallbackRelays) : []
  const revokeScope = grantRelayConnectionOperationScope([...relays1063, ...noteRelays])
  try {
    const pool = new Map<string, GifMetadata>()
    const userKey = userPubkey?.toLowerCase() ?? ''
    const followAuthors = followingPubkeys.filter((p) => p && p.toLowerCase() !== userKey)
    const knownAuthors = new Set<string>()
    if (userKey) knownAuthors.add(userKey)
    for (const pk of followAuthors) knownAuthors.add(pk.toLowerCase())

    /** Own + follows' 1063 may live on inbox relays, not only GIF hubs. */
    const personal1063Relays = dedupeMediaPickerRelayUrls([...relays1063, ...noteFallbackRelays])

    if (userPubkey) {
      const ownEvents = await fetch1063Paginated(personal1063Relays, fetchOpts, {
        authors: [userPubkey]
      })
      mergeGifEventsIntoPool(ownEvents, pool)
    }

    for (const chunk of chunkPubkeys(followAuthors, METADATA_BATCH_AUTHORS_CHUNK)) {
      const followEvents = await fetch1063Paginated(personal1063Relays, fetchOpts, { authors: chunk })
      mergeGifEventsIntoPool(followEvents, pool)
    }

    const globalEvents = await fetch1063Paginated(
      relays1063,
      fetchOpts,
      {},
      GIF_OTHERS_1063_MAX + pool.size + 200
    )
    let othersAdded = 0
    for (const event of globalEvents) {
      if (knownAuthors.has(event.pubkey.toLowerCase())) continue
      const gif = parseGifFromEvent(event)
      if (!gif) continue
      const key = normalizeGifUrl(gif.url)
      if (pool.has(key)) continue
      pool.set(key, gif)
      othersAdded++
      if (othersAdded >= GIF_OTHERS_1063_MAX) break
    }

    if (pool.size < GIF_NOTES_FALLBACK_THRESHOLD) {
      const noteEvents = await queryService.fetchEvents(
        gifNoteFallbackRelays(noteFallbackRelays),
        {
          kinds: [kinds.ShortTextNote, ExtendedKind.COMMENT],
          limit: GIF_NOTES_RELAY_LIMIT
        },
        fetchOpts
      )
      mergeGifEventsIntoPool(noteEvents, pool)
    }

    return sortGifsForPicker(dedupeGifsByUrl([...pool.values()]), userPubkey, followingPubkeys)
  } finally {
    revokeScope()
  }
}

/** Merge one or more GIF rows into IndexedDB (e.g. after a local kind-1063 publish). */
export async function cachePublishedGif(gif: GifMetadata): Promise<void> {
  await persistGifPool([gif])
}

async function persistGifPool(gifs: GifMetadata[]): Promise<void> {
  if (gifs.length === 0) return
  let existing: GifMetadata[] = []
  try {
    const row = await indexedDb.getGifCache()
    if (row?.gifs?.length) {
      existing = row.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
    }
  } catch {
    /* ignore */
  }
  const merged = dedupeGifsByUrl([...gifs, ...existing])
  await indexedDb.setGifCache(merged, Date.now())
}

export function gifMetadataMatchesSearch(gif: GifMetadata, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    gif.description,
    ...(gif.emotions ?? []),
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

/** Full IndexedDB GIF pool for local search and display. */
export async function getAllCachedGifsForSearch(
  userPubkey: string | null = null,
  followingPubkeys: readonly string[] = []
): Promise<GifMetadata[]> {
  try {
    const cached = await indexedDb.getGifCache()
    if (!cached?.gifs?.length) return []
    const normalized = cached.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
    return sortGifsForPicker(
      dedupeGifsByUrl(normalized),
      userPubkey,
      followingPubkeys
    )
  } catch {
    return []
  }
}

export type FetchGifsOptions = {
  forceRefresh?: boolean
  userPubkey: string | null
  followingPubkeys?: readonly string[]
  noteFallbackRelays?: readonly string[]
}

/**
 * Fetch the full GIF picker pool from relays and persist to IndexedDB.
 * Order: all viewer kind 1063 → all follows' kind 1063 → up to 500 other kind 1063;
 * if still < 50 entries, adds GIFs parsed from kind 1 / 1111.
 */
export async function fetchGifs(options: FetchGifsOptions): Promise<GifMetadata[]> {
  const {
    forceRefresh = false,
    userPubkey,
    followingPubkeys = [],
    noteFallbackRelays = []
  } = options

  if (!forceRefresh) {
    const cached = await indexedDb.getGifCache()
    if (
      cached &&
      cached.gifs.length >= MIN_GIF_CACHE_ENTRIES &&
      Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS
    ) {
      const normalized = cached.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
      return sortGifsForPicker(normalized, userPubkey, followingPubkeys)
    }
  }

  let staleFallback: GifMetadata[] | null = null
  const row = await indexedDb.getGifCache()
  if (row?.gifs?.length) {
    staleFallback = row.gifs.map((g) => normalizeCachedGif(g as GifMetadata))
  }

  try {
    const pool = await loadGifPoolFromRelays({
      userPubkey,
      followingPubkeys,
      noteFallbackRelays,
      fetchOpts: GIF_FETCH_OPTS
    })
    if (pool.length > 0) {
      await persistGifPool(pool)
    }
    const merged = await getAllCachedGifsForSearch(userPubkey, followingPubkeys)
    if (merged.length > 0) return merged
    return pool
  } catch (err) {
    if (staleFallback?.length) {
      return sortGifsForPicker(staleFallback, userPubkey, followingPubkeys)
    }
    throw err
  }
}

/** Background session preload into IndexedDB using the tiered 1063 fetch. */
export async function preloadGifsIntoIdbCache(
  userPubkey: string | null,
  followingPubkeys: readonly string[] = [],
  noteFallbackRelays: readonly string[] = []
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
    const pool = await loadGifPoolFromRelays({
      userPubkey,
      followingPubkeys,
      noteFallbackRelays,
      fetchOpts: GIF_PRELOAD_FETCH_OPTS
    })
    if (pool.length > 0) {
      await persistGifPool(pool)
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
  _outboxRelayUrls: readonly string[],
  userPubkey: string | null,
  _signal?: AbortSignal
): Promise<void> {
  return preloadGifsIntoIdbCache(userPubkey, [])
}

/**
 * Return whatever is currently in the IndexedDB GIF cache without fetching from relays.
 */
export async function getCachedGifs(
  userPubkey: string | null = null,
  followingPubkeys: readonly string[] = []
): Promise<GifMetadata[]> {
  return getAllCachedGifsForSearch(userPubkey, followingPubkeys)
}

/** Instant local search over the IndexedDB GIF cache (no relay round-trip). */
export async function searchGifs(
  query: string,
  userPubkey: string | null = null,
  followingPubkeys: readonly string[] = []
): Promise<GifMetadata[]> {
  const q = query.trim()
  const pool = await getAllCachedGifsForSearch(userPubkey, followingPubkeys)
  if (!q) return pool
  return pool.filter((g) => gifMetadataMatchesSearch(g, q))
}

/** @deprecated Merges by URL with a hard cap; prefer {@link persistGifPool}. */
export async function mergeGifsIntoIdbCache(incoming: GifMetadata[]): Promise<void> {
  await persistGifPool(incoming)
}
