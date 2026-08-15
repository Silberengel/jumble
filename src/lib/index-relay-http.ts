/**
 * HTTP JSON API for index-style relays (e.g. gc_index_relay: POST /api/events/filter, POST /api/events,
 * DELETE /api/events/:id, POST /api/publications/search, POST /api/publications/sections/search).
 * @see gc_index_relay lib/gc_index_relay_web/router.ex
 *
 * **Local dev:** loopback bases (`http://localhost:*` / `http://127.0.0.1:*`) are automatically fetched via
 * the Vite same-origin proxy `/dev-index-relay` → `VITE_DEV_INDEX_RELAY_TARGET` (default in `vite.config.ts`).
 * Known broken CORS HTTPS hosts (e.g. nos.lol) use `/dev-cors-index-relay` (see `vite.config.ts` + `url.ts`).
 * Production and other remote HTTPS relays still need CORS or your own reverse proxy.
 */
import { ExtendedKind } from '@/constants'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { normalizeGeneralSearchQuery } from '@/lib/general-search-text-match'
import logger from '@/lib/logger'
import { relaySessionStrikes } from '@/lib/relay-strikes'
import {
  devProxyCorsProblematicHttpsIndexRelayBase,
  devProxyLoopbackHttpRelayBase,
  normalizeHttpRelayUrl
} from '@/lib/url'
import type { Filter, Event as NEvent } from 'nostr-tools'
import { kinds, verifyEvent } from 'nostr-tools'

function trimSlash(base: string): string {
  return base.replace(/\/+$/, '')
}

function indexRelayFilterUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events/filter`
}

function indexRelayPublishUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events`
}

function indexRelayEventDeleteUrl(baseUrl: string, eventId: string): string {
  const id = eventId.trim().toLowerCase()
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events/${id}`
}

const REPLACEABLE_COORDINATE_RE = /^(\d+):([0-9a-f]{64}):(.*)$/i

function indexRelayPublicationMetadataSearchUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/publications/search`
}

function indexRelayPublicationSectionSearchUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/publications/sections/search`
}

function indexRelayWikiSearchUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/wiki/search`
}

function indexRelaySuggestUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/suggest`
}

function indexRelayPublicationNaddrUrl(baseUrl: string, naddr: string, path: string): string {
  const encoded = encodeURIComponent(naddr.trim())
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/publications/${encoded}/${path}`
}

/** Map a Nostr filter to gc_index_relay POST body (requires `limit` 1–100; strips unsupported keys). */
function nostrFilterToIndexRelayBody(f: Filter): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  const lim = f.limit
  const capped = lim == null || lim < 1 ? 100 : Math.min(100, Math.max(1, Number(lim) || 100))
  body.limit = capped
  if (f.ids?.length) {
    const ids = f.ids
      .map((id) => id.trim().toLowerCase())
      .filter((id) => /^[0-9a-f]{64}$/.test(id))
    if (ids.length === 0) return null
    body.ids = ids
  }
  if (f.authors?.length) {
    const authors = f.authors
      .map((author) => author.trim().toLowerCase())
      .filter((author) => /^[0-9a-f]{64}$/.test(author))
    if (authors.length === 0) return null
    body.authors = authors
  }
  if (f.kinds?.length) body.kinds = f.kinds
  if (f.since != null) body.since = f.since
  if (f.until != null) body.until = f.until
  /** NIP-50 `search` is not supported on Mercury `/api/events/filter` (400 Unknown filter key). */
  /**
   * Single-letter tag filter keys are **case-sensitive** on Mercury (`#T` title slug ≠ `#t` subject;
   * `#N` author slug ≠ `#n`). Preserve the letter case from the Filter object.
   */
  const tagBuckets = new Map<string, string[]>()
  for (const key of Object.keys(f)) {
    if (key.length !== 2 || !key.startsWith('#')) continue
    const letter = key[1]
    if (!/^[a-zA-Z]$/.test(letter)) continue
    const v = (f as Record<string, unknown>)[key]
    if (!Array.isArray(v) || v.length === 0) continue
    const normKey = `#${letter}`
    const cur = tagBuckets.get(normKey) ?? []
    for (const item of v) {
      if (item != null && String(item).length > 0) cur.push(String(item))
    }
    tagBuckets.set(normKey, cur)
  }
  for (const [k, vals] of tagBuckets) {
    if (vals.length === 0) continue
    body[k] = [...new Set(vals)]
  }

  // Never widen a tag filter that Mercury rejected/stripped (e.g. `#source`) into kinds-only.
  const hadTagKeys = Object.keys(f).some((key) => key.length >= 2 && key.startsWith('#'))
  const keptTagKeys = Object.keys(body).some((key) => key.startsWith('#'))
  if (hadTagKeys && !keptTagKeys && !body.ids && !body.authors) {
    return null
  }

  return body
}

const INDEX_RELAY_HTTP_WARN_COOLDOWN_MS = 25_000
const lastIndexRelayHttpWarnAtByEndpoint = new Map<string, number>()

const DEV_INDEX_RELAY_TRANSPORT_HINT_MS = 60_000
let lastDevIndexRelayTransportHintAt = 0

const DEV_INDEX_RELAY_HTTP_ERROR_HINT_MS = 60_000
let lastDevIndexRelayHttpErrorHintAt = 0

function warnIndexRelayHttpThrottled(endpoint: string, message: string, meta: Record<string, unknown>) {
  const now = Date.now()
  const prev = lastIndexRelayHttpWarnAtByEndpoint.get(endpoint) ?? 0
  if (now - prev < INDEX_RELAY_HTTP_WARN_COOLDOWN_MS) return
  lastIndexRelayHttpWarnAtByEndpoint.set(endpoint, now)
  logger.warn(message, meta)
}

/** True when the relay cannot be reached (down, DNS, browser blocked, etc.). Not HTTP 4xx/5xx from a live server. */
export function isIndexRelayTransportFailure(err: unknown): boolean {
  if (err instanceof IndexRelayTransportError) return true
  if (err == null || typeof err !== 'object') return false
  const e = err as Error & { name?: string; cause?: unknown }
  if (e.name === 'AbortError') return false
  if (e instanceof TypeError) {
    const m = e.message || ''
    if (/failed to fetch|load failed|networkerror when attempting to fetch resource/i.test(m)) return true
  }
  const msg = String((e as Error).message || err)
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ERR_CONNECTION|network request failed|fetch failed/i.test(msg)) return true
  if (e.cause != null && isIndexRelayTransportFailure(e.cause)) return true
  return false
}

export class IndexRelayTransportError extends Error {
  constructor(cause?: unknown) {
    super('Index relay unreachable')
    this.name = 'IndexRelayTransportError'
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

function isDevViteIndexRelayProxyPath(endpoint: string): boolean {
  return (
    import.meta.env.DEV &&
    (endpoint.includes('/dev-index-relay') || endpoint.includes('/dev-cors-index-relay'))
  )
}

/**
 * When the Vite `/dev-index-relay` proxy is unreachable (connection refused), skip further filter
 * fetches for this tab. A single HTTP 5xx on one filter must not disable other filters or
 * publications/search — those endpoints stay available via {@link shouldSkipDevIndexRelayFetch}.
 */
let devIndexRelayUnavailableThisSession = false
let devIndexRelaySkipLogged = false

export function isDevIndexRelayUnavailableThisSession(): boolean {
  return devIndexRelayUnavailableThisSession
}

export function clearDevIndexRelayUnavailableThisSession(): void {
  devIndexRelayUnavailableThisSession = false
  devIndexRelaySkipLogged = false
}

function markDevIndexRelayUnavailableFromTransport(endpoint: string): void {
  if (!isDevViteIndexRelayProxyPath(endpoint)) return
  if (devIndexRelayUnavailableThisSession) return
  devIndexRelayUnavailableThisSession = true
  if (!devIndexRelaySkipLogged) {
    devIndexRelaySkipLogged = true
    logger.debug(
      '[IndexRelayHttp] Dev index relay unreachable; skipping further filter fetches this session (search APIs continue).'
    )
  }
}

function shouldSkipDevIndexRelayFetch(endpoint: string): boolean {
  if (!import.meta.env.DEV || !devIndexRelayUnavailableThisSession || !isDevViteIndexRelayProxyPath(endpoint)) {
    return false
  }
  // NIP-50-style search endpoints are separate from POST /api/events/filter; keep them available
  // when the filter API tripped the dev session skip (otherwise a missing local :4000 index relay,
  // or one transient 5xx, silently disables remote wiki/publication full-text search for the session).
  if (
    endpoint.includes('/api/publications/sections/search') ||
    endpoint.includes('/api/publications/search') ||
    endpoint.includes('/api/wiki/search') ||
    endpoint.includes('/api/suggest') ||
    endpoint.includes('/api/publications/')
  ) {
    return false
  }
  return true
}

function maybeLogDevIndexRelayUnreachableHint(): void {
  if (import.meta.env.PROD || typeof window === 'undefined') return
  const now = Date.now()
  if (now - lastDevIndexRelayTransportHintAt < DEV_INDEX_RELAY_TRANSPORT_HINT_MS) return
  lastDevIndexRelayTransportHintAt = now
  logger.debug(
    'HTTP index relay is unreachable in dev. Start the relay, or set VITE_DEV_INDEX_RELAY_TARGET if it is not on the default URL.'
  )
}

/** Server responded (proxy works) but returned 5xx — distinct from connection refused / down relay. */
function maybeLogDevIndexRelayHttpErrorHint(status: number, detail?: string): void {
  if (import.meta.env.PROD || typeof window === 'undefined') return
  const now = Date.now()
  if (now - lastDevIndexRelayHttpErrorHintAt < DEV_INDEX_RELAY_HTTP_ERROR_HINT_MS) return
  lastDevIndexRelayHttpErrorHintAt = now
  const msg =
    `[IndexRelayHttp] Dev index relay returned HTTP ${status} for POST /api/events/filter. ` +
    'The process behind VITE_DEV_INDEX_RELAY_TARGET (default http://127.0.0.1:4000) is reachable but errored — inspect that server’s logs, database, and version (expected: gc_index_relay-style API). ' +
    'To use a different relay, set VITE_DEV_INDEX_RELAY_TARGET in .env.local.'
  if (detail) {
    logger.warn(msg, { responseSnippet: detail })
  } else {
    logger.warn(msg)
  }
}

function handleFilterTransportFailure(endpoint: string, err?: unknown): void {
  if (import.meta.env.DEV && isDevViteIndexRelayProxyPath(endpoint)) {
    markDevIndexRelayUnavailableFromTransport(endpoint)
    logger.debug('[IndexRelayHttp] filter unreachable', { endpoint })
    maybeLogDevIndexRelayUnreachableHint()
    return
  }
  // CORS / offline index relays are optional; strikes will skip after repeated failures.
  logger.debug('[IndexRelayHttp] filter transport failure', {
    endpoint,
    error: err ?? 'unreachable'
  })
}

/** NKBIP-01 kind 30040 indexes always have empty `content` (relays may JSON-encode that as `null`). */
function normalizedIndexRelayContent(kind: number, contentRaw: unknown): string | null {
  if (kind === ExtendedKind.PUBLICATION) return ''
  if (typeof contentRaw === 'string') return contentRaw
  if (contentRaw == null) return ''
  return null
}

function rawToVerifiedEvent(raw: Record<string, unknown>): NEvent | null {
  try {
    const id = raw.id
    const pubkey = raw.pubkey
    const created_at = raw.created_at
    const kind = raw.kind
    const tags = raw.tags
    const contentRaw = raw.content
    const sig = raw.sig
    if (
      typeof id !== 'string' ||
      typeof pubkey !== 'string' ||
      typeof created_at !== 'number' ||
      typeof kind !== 'number' ||
      !Array.isArray(tags) ||
      typeof sig !== 'string'
    ) {
      return null
    }
    const content = normalizedIndexRelayContent(kind, contentRaw)
    if (content === null) return null
    const ev = { id, pubkey, created_at, kind, tags, content, sig } as NEvent
    return verifyEvent(ev) ? ev : null
  } catch {
    return null
  }
}

/**
 * Parse HTTP index relay rows for Library discovery. Kind 30040 content is always normalized to `''`.
 * Signature must verify — tag order is part of the signed event (NKBIP-01 reading order).
 */
export function rawToIndexRelayEvent(raw: Record<string, unknown>): NEvent | null {
  try {
    const id = raw.id
    const pubkey = raw.pubkey
    const created_at = raw.created_at
    const kind = raw.kind
    const tags = raw.tags
    const contentRaw = raw.content
    const sig = raw.sig
    if (
      typeof id !== 'string' ||
      typeof pubkey !== 'string' ||
      typeof created_at !== 'number' ||
      typeof kind !== 'number' ||
      !Array.isArray(tags) ||
      typeof sig !== 'string'
    ) {
      return null
    }
    const content = normalizedIndexRelayContent(kind, contentRaw)
    if (content === null) return null
    const ev = {
      id: id.toLowerCase(),
      pubkey: pubkey.toLowerCase(),
      created_at,
      kind,
      tags,
      content,
      sig
    } as NEvent
    return verifyEvent(ev) ? ev : null
  } catch {
    return null
  }
}

export type TIndexRelayLibraryPage = {
  events: NEvent[]
  /** Rows returned by the relay before client-side filtering (drives pagination). */
  apiRowCount: number
}

/**
 * Query one HTTP index relay. Runs one POST per filter when given an array.
 */
function devHttpIndexRelayBaseForFetch(baseUrl: string): string {
  const n = normalizeHttpRelayUrl(baseUrl) || baseUrl
  return devProxyCorsProblematicHttpsIndexRelayBase(devProxyLoopbackHttpRelayBase(n))
}

export async function queryIndexRelay(
  baseUrl: string,
  filter: Filter | Filter[],
  options?: { signal?: AbortSignal }
): Promise<NEvent[]> {
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayFilterUrl(base)
  const filters = Array.isArray(filter) ? filter : [filter]
  const out: NEvent[] = []
  const seen = new Set<string>()
  if (shouldSkipDevIndexRelayFetch(endpoint)) {
    return out
  }
  for (const f of filters) {
    const body = nostrFilterToIndexRelayBody(filterForIndexRelay(f))
    if (!body) continue
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: options?.signal,
        timeoutMs: 25_000
      })
      if (!res.ok) {
        if (isDevViteIndexRelayProxyPath(endpoint)) {
          let detail = ''
          try {
            detail = (await res.text()).trim().slice(0, 400)
          } catch {
            /* ignore */
          }
          if (res.status >= 500 && res.status <= 599) {
            maybeLogDevIndexRelayHttpErrorHint(res.status, detail || undefined)
          } else {
            logger.debug('[IndexRelayHttp] filter HTTP response', {
              endpoint,
              status: res.status,
              detail: detail || undefined
            })
          }
          if (res.status >= 400 && res.status < 500) {
            relaySessionStrikes.recordReadFailure(baseUrl, 'http')
          }
        } else {
          warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] filter request failed', {
            endpoint,
            status: res.status
          })
        }
        if (res.status >= 500) {
          throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
        }
        continue
      }
      clearDevIndexRelayUnavailableThisSession()
      const json = (await res.json()) as { data?: unknown }
      const data = json.data
      if (!Array.isArray(data)) continue
      for (const item of data) {
        if (!item || typeof item !== 'object') continue
        const ev = rawToVerifiedEvent(item as Record<string, unknown>)
        if (ev && !seen.has(ev.id)) {
          seen.add(ev.id)
          out.push(ev)
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      if (e instanceof IndexRelayTransportError) throw e
      if (isIndexRelayTransportFailure(e)) {
        handleFilterTransportFailure(endpoint, e)
        throw new IndexRelayTransportError(e)
      }
      warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] filter request error', { endpoint, error: e })
    }
  }
  return out
}

/** Library discovery: paginate using {@link rawToIndexRelayEvent} and the relay's raw row count. */
export async function queryIndexRelayForLibrary(
  baseUrl: string,
  filter: Filter,
  options?: { signal?: AbortSignal }
): Promise<TIndexRelayLibraryPage> {
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayFilterUrl(base)
  if (shouldSkipDevIndexRelayFetch(endpoint)) {
    return { events: [], apiRowCount: 0 }
  }

  const body = nostrFilterToIndexRelayBody(filterForIndexRelay(filter))
  if (!body) {
    return { events: [], apiRowCount: 0 }
  }
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: options?.signal,
      timeoutMs: 25_000
    })
    if (!res.ok) {
      if (res.status >= 500) {
        throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      }
      return { events: [], apiRowCount: 0 }
    }
    clearDevIndexRelayUnavailableThisSession()
    const json = (await res.json()) as { data?: unknown }
    const data = json.data
    if (!Array.isArray(data)) return { events: [], apiRowCount: 0 }

    const events: NEvent[] = []
    const seen = new Set<string>()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const ev = rawToIndexRelayEvent(item as Record<string, unknown>)
      if (ev && !seen.has(ev.id)) {
        seen.add(ev.id)
        events.push(ev)
      }
    }
    return { events, apiRowCount: data.length }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] library filter request error', {
      endpoint,
      error: e
    })
    return { events: [], apiRowCount: 0 }
  }
}

/** Kind-30040 filter query via POST /api/events/filter (NIP-01 only — no NIP-50 `search`). */
export async function queryIndexRelayPublicationSearch(
  baseUrl: string,
  filter: Filter,
  options?: { signal?: AbortSignal }
): Promise<TIndexRelayLibraryPage> {
  return queryIndexRelayForLibrary(baseUrl, filter, options)
}

function filterForIndexRelay(f: Filter): Filter {
  const rest = { ...f } as Filter & { search?: unknown }
  delete rest.search
  return rest as Filter
}

/** Kind-30040 metadata search (d / title / author / source) on Mercury-style index relays. */
export type IndexRelayPublicationSearchBody = {
  q?: string
  title?: string
  author?: string
  language?: string
  subject?: string
  d?: string
  identifier?: string
  limit?: number
}

function publicationSearchBodyHasQuery(body: IndexRelayPublicationSearchBody): boolean {
  const keys: (keyof IndexRelayPublicationSearchBody)[] = [
    'q',
    'title',
    'author',
    'language',
    'subject',
    'd',
    'identifier'
  ]
  return keys.some((key) => {
    const v = body[key]
    return typeof v === 'string' && v.trim().length > 0
  })
}

function parseIndexRelayEventPage(json: { data?: unknown }): TIndexRelayLibraryPage {
  const data = json.data
  if (!Array.isArray(data)) return { events: [], apiRowCount: 0 }

  const events: NEvent[] = []
  const seen = new Set<string>()
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const ev = rawToIndexRelayEvent(item as Record<string, unknown>)
    if (ev && !seen.has(ev.id)) {
      seen.add(ev.id)
      events.push(ev)
    }
  }
  return { events, apiRowCount: data.length }
}

/** Kind-30040 metadata search (d / title / author / source / structured fields) on Mercury-style index relays. */
export async function queryIndexRelayPublicationMetadataSearch(
  baseUrl: string,
  query: string | IndexRelayPublicationSearchBody,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<TIndexRelayLibraryPage> {
  const body: IndexRelayPublicationSearchBody =
    typeof query === 'string'
      ? { q: normalizeGeneralSearchQuery(query.trim()) }
      : { ...query }

  if (typeof body.q === 'string') {
    body.q = normalizeGeneralSearchQuery(body.q.trim())
  }
  if (!publicationSearchBodyHasQuery(body)) return { events: [], apiRowCount: 0 }

  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublicationMetadataSearchUrl(base)
  if (shouldSkipDevIndexRelayFetch(endpoint)) {
    return { events: [], apiRowCount: 0 }
  }

  const limit = Math.max(1, Math.min(body.limit ?? options?.limit ?? 100, 100))
  const payload: IndexRelayPublicationSearchBody = { ...body, limit }
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
      timeoutMs: 60_000
    })
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) return { events: [], apiRowCount: 0 }
      if (res.status >= 500) {
        // Do NOT mark the whole dev index-relay session unavailable here: this best-effort search
        // endpoint is slower/heavier than /api/events/filter, and a 5xx (often a dev-proxy timeout)
        // must not disable the bulk metadata loader for the rest of the session.
        throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      }
      return { events: [], apiRowCount: 0 }
    }
    return parseIndexRelayEventPage((await res.json()) as { data?: unknown })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] publication metadata search request error', {
      endpoint,
      error: e
    })
    return { events: [], apiRowCount: 0 }
  }
}

export type IndexRelaySuggestRow = {
  kind?: number
  title?: string | null
  author?: string | null
  authors?: string[]
  d?: string | null
  i?: string[]
  naddr?: string | null
  id?: string
  pubkey?: string
}

/** Typeahead over T/N/d/i (no body scan) via POST /api/suggest. */
export async function queryIndexRelaySuggest(
  baseUrl: string,
  q: string,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<IndexRelaySuggestRow[]> {
  const query = normalizeGeneralSearchQuery(q.trim())
  if (!query || query.length < 2) return []

  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelaySuggestUrl(base)
  if (shouldSkipDevIndexRelayFetch(endpoint)) return []

  const limit = Math.max(1, Math.min(options?.limit ?? 10, 25))
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, limit }),
      signal: options?.signal,
      timeoutMs: 8_000
    })
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) return []
      if (res.status >= 500) throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      return []
    }
    const json = (await res.json()) as { data?: unknown }
    return Array.isArray(json.data) ? (json.data as IndexRelaySuggestRow[]) : []
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] suggest request error', {
      endpoint,
      error: e
    })
    return []
  }
}

export type IndexRelayPublicationMeta = {
  readable: boolean
  event_count: number
  index_count: number
  content_count: number
  d?: string | null
  naddr?: string | null
}

export type IndexRelayPublicationTocEntry = {
  pos: number
  kind: number
  d?: string | null
  id?: string | null
  title?: string | null
  event?: Record<string, unknown> | null
}

export type IndexRelayPublicationStreamItem = {
  pos: number
  kind: number
  d?: string | null
  id?: string | null
  event?: Record<string, unknown> | null
}

export type IndexRelayPublicationStreamMeta = {
  readable: boolean
  event_count: number
  index_count: number
  content_count: number
}

function parseNdjsonLines(text: string): IndexRelayPublicationStreamItem[] {
  const out: IndexRelayPublicationStreamItem[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed) as IndexRelayPublicationStreamItem
      if (row && typeof row === 'object' && typeof row.pos === 'number') out.push(row)
    } catch {
      // skip malformed lines
    }
  }
  return out
}

function streamMetaFromHeaders(res: Response): IndexRelayPublicationStreamMeta {
  const num = (name: string) => {
    const raw = res.headers.get(name)
    const n = raw != null ? Number(raw) : NaN
    return Number.isFinite(n) ? n : 0
  }
  return {
    readable: String(res.headers.get('x-readable') || '').toLowerCase() === 'true',
    event_count: num('x-event-count'),
    index_count: num('x-index-count'),
    content_count: num('x-content-count')
  }
}

/** GET /api/publications/:naddr/meta */
export async function queryIndexRelayPublicationMeta(
  baseUrl: string,
  naddr: string,
  options?: { signal?: AbortSignal }
): Promise<IndexRelayPublicationMeta | null> {
  const id = naddr.trim()
  if (!id) return null
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublicationNaddrUrl(base, id, 'meta')
  if (shouldSkipDevIndexRelayFetch(endpoint)) return null
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
      timeoutMs: 15_000
    })
    if (!res.ok) {
      if (res.status === 404) return null
      if (res.status >= 500) throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      return null
    }
    return (await res.json()) as IndexRelayPublicationMeta
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    return null
  }
}

/** GET /api/publications/:naddr/toc */
export async function queryIndexRelayPublicationToc(
  baseUrl: string,
  naddr: string,
  options?: { signal?: AbortSignal }
): Promise<IndexRelayPublicationTocEntry[]> {
  const id = naddr.trim()
  if (!id) return []
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublicationNaddrUrl(base, id, 'toc')
  if (shouldSkipDevIndexRelayFetch(endpoint)) return []
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
      timeoutMs: 30_000
    })
    if (!res.ok) {
      if (res.status === 404) return []
      if (res.status >= 500) throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      return []
    }
    const json = (await res.json()) as { toc?: unknown }
    return Array.isArray(json.toc) ? (json.toc as IndexRelayPublicationTocEntry[]) : []
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    return []
  }
}

/** GET /api/publications/:naddr/stream?from=&limit= as NDJSON. */
export async function queryIndexRelayPublicationStream(
  baseUrl: string,
  naddr: string,
  options?: { from?: number; limit?: number; signal?: AbortSignal }
): Promise<{ items: IndexRelayPublicationStreamItem[]; meta: IndexRelayPublicationStreamMeta }> {
  const id = naddr.trim()
  const empty = {
    items: [] as IndexRelayPublicationStreamItem[],
    meta: { readable: false, event_count: 0, index_count: 0, content_count: 0 }
  }
  if (!id) return empty
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const from = Math.max(0, options?.from ?? 0)
  const limit = Math.max(1, Math.min(options?.limit ?? 40, 200))
  const endpoint = `${indexRelayPublicationNaddrUrl(base, id, 'stream')}?from=${from}&limit=${limit}`
  if (shouldSkipDevIndexRelayFetch(endpoint)) return empty
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/x-ndjson, application/json' },
      signal: options?.signal,
      timeoutMs: 45_000
    })
    if (!res.ok) {
      if (res.status === 404) return empty
      if (res.status >= 500) throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      return empty
    }
    const text = await res.text()
    return { items: parseNdjsonLines(text), meta: streamMetaFromHeaders(res) }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    return empty
  }
}

/** GET /api/publications/:naddr/export as NDJSON (full flattened list). */
export async function queryIndexRelayPublicationExport(
  baseUrl: string,
  naddr: string,
  options?: { signal?: AbortSignal }
): Promise<{ items: IndexRelayPublicationStreamItem[]; meta: IndexRelayPublicationStreamMeta }> {
  const id = naddr.trim()
  const empty = {
    items: [] as IndexRelayPublicationStreamItem[],
    meta: { readable: false, event_count: 0, index_count: 0, content_count: 0 }
  }
  if (!id) return empty
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublicationNaddrUrl(base, id, 'export')
  if (shouldSkipDevIndexRelayFetch(endpoint)) return empty
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/x-ndjson, application/json' },
      signal: options?.signal,
      timeoutMs: 120_000
    })
    if (!res.ok) {
      if (res.status === 404) return empty
      if (res.status >= 500) throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      return empty
    }
    const text = await res.text()
    return { items: parseNdjsonLines(text), meta: streamMetaFromHeaders(res) }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    return empty
  }
}

/**
 * Kind-30041 section search on Mercury-style index relays (title tags + body).
 *
 * Uses `POST /api/publications/sections/search` on gc_index_relay. The client also issues WS NIP-50
 * `search` queries to document relays that advertise NIP-50 (see searchWsRelaysForPublicationContentNip50)
 * and falls back to client-side paginated matching when HTTP search is unavailable.
 */
export async function queryIndexRelayPublicationContentSearch(
  baseUrl: string,
  query: string,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<TIndexRelayLibraryPage> {
  const q = normalizeGeneralSearchQuery(query.trim())
  if (!q) return { events: [], apiRowCount: 0 }

  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublicationSectionSearchUrl(base)
  if (shouldSkipDevIndexRelayFetch(endpoint)) {
    return { events: [], apiRowCount: 0 }
  }

  const limit = Math.max(1, Math.min(options?.limit ?? 100, 100))
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q, limit }),
      signal: options?.signal,
      timeoutMs: 45_000
    })
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) return { events: [], apiRowCount: 0 }
      if (res.status >= 500) {
        // Do NOT mark the whole dev index-relay session unavailable here: this best-effort full-text
        // endpoint is slower/heavier than /api/events/filter, and a 5xx (often a dev-proxy timeout)
        // must not disable the bulk metadata loader for the rest of the session.
        throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      }
      return { events: [], apiRowCount: 0 }
    }
    const json = (await res.json()) as { data?: unknown }
    const data = json.data
    if (!Array.isArray(data)) return { events: [], apiRowCount: 0 }

    const events: NEvent[] = []
    const seen = new Set<string>()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const ev = rawToIndexRelayEvent(item as Record<string, unknown>)
      if (ev && !seen.has(ev.id)) {
        seen.add(ev.id)
        events.push(ev)
      }
    }
    return { events, apiRowCount: data.length }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] publication content search request error', {
      endpoint,
      error: e
    })
    return { events: [], apiRowCount: 0 }
  }
}

/**
 * Kind-30818 NIP-54 wiki article search on Mercury-style index relays via POST /api/wiki/search.
 *
 * Searches BOTH the article body (`content`) AND metadata tags (`d`, `title`, `summary`, `source`)
 * server-side, ranked by exact-phrase-then-relevance-then-recency. This is the wiki analog of
 * {@link queryIndexRelayPublicationContentSearch} and is driven by the generic Search page's
 * FULL TEXT mode (see SearchResult). Exact `d`-tag lookups stay on the NIP-01 `#d` filter path.
 */
export async function queryIndexRelayWikiSearch(
  baseUrl: string,
  query: string,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<TIndexRelayLibraryPage> {
  const q = normalizeGeneralSearchQuery(query.trim())
  if (!q) return { events: [], apiRowCount: 0 }

  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayWikiSearchUrl(base)
  if (shouldSkipDevIndexRelayFetch(endpoint)) {
    return { events: [], apiRowCount: 0 }
  }

  const limit = Math.max(1, Math.min(options?.limit ?? 100, 100))
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q, limit }),
      signal: options?.signal,
      timeoutMs: 45_000
    })
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) return { events: [], apiRowCount: 0 }
      if (res.status >= 500) {
        // Best-effort search endpoint: a 5xx (often a dev-proxy timeout) must not disable the
        // whole dev index-relay session, so surface a transport error without flagging it globally.
        throw new IndexRelayTransportError(new Error(`HTTP ${res.status}`))
      }
      return { events: [], apiRowCount: 0 }
    }
    const json = (await res.json()) as { data?: unknown }
    const data = json.data
    if (!Array.isArray(data)) return { events: [], apiRowCount: 0 }

    const events: NEvent[] = []
    const seen = new Set<string>()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const ev = rawToIndexRelayEvent(item as Record<string, unknown>)
      if (ev && !seen.has(ev.id)) {
        seen.add(ev.id)
        events.push(ev)
      }
    }
    return { events, apiRowCount: data.length }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    if (e instanceof IndexRelayTransportError) throw e
    if (isIndexRelayTransportFailure(e)) {
      handleFilterTransportFailure(endpoint, e)
      throw new IndexRelayTransportError(e)
    }
    warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] wiki search request error', {
      endpoint,
      error: e
    })
    return { events: [], apiRowCount: 0 }
  }
}

export async function publishEventToHttpRelay(
  baseUrl: string,
  event: NEvent,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublishUrl(base)
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: {
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
          sig: event.sig
        }
      }),
      signal: options?.signal,
      timeoutMs: 25_000
    })
    if (!res.ok) {
      // 409 Conflict means the relay already has this event — treat as success.
      if (res.status === 409) return
      if (isDevViteIndexRelayProxyPath(endpoint) && res.status === 500) {
        throw new IndexRelayTransportError()
      }
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
  } catch (e) {
    if (e instanceof IndexRelayTransportError) throw e
    if ((e as Error).name === 'AbortError') throw e
    if (isIndexRelayTransportFailure(e)) {
      throw new IndexRelayTransportError(e)
    }
    throw e
  }
}

/** Hex event ids from kind-5 `e` tags (sync; does not resolve `a` coordinates). */
export function collectKind5DeletionTargetIdsFromTags(deletionEvent: NEvent): string[] {
  const ids = new Set<string>()
  for (const tag of deletionEvent.tags) {
    if (tag[0] !== 'e' || !tag[1]) continue
    const id = tag[1].trim().toLowerCase()
    if (/^[0-9a-f]{64}$/.test(id)) ids.add(id)
  }
  return [...ids]
}

/** Resolve all target event ids referenced by a signed kind-5 (e tags + index lookup for a tags). */
export async function resolveKind5DeletionTargetIdsForHttpRelay(
  baseUrl: string,
  deletionEvent: NEvent,
  options?: { signal?: AbortSignal }
): Promise<string[]> {
  const ids = new Set(collectKind5DeletionTargetIdsFromTags(deletionEvent))
  const author = deletionEvent.pubkey.trim().toLowerCase()

  for (const tag of deletionEvent.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue
    const match = REPLACEABLE_COORDINATE_RE.exec(tag[1].trim())
    if (!match) continue
    const kind = Number(match[1])
    const pubkey = match[2].toLowerCase()
    const d = match[3]
    if (!Number.isFinite(kind) || pubkey !== author) continue

    const events = await queryIndexRelay(
      baseUrl,
      { authors: [pubkey], kinds: [kind], '#d': [d], limit: 100 },
      options
    )
    for (const ev of events) {
      if (ev.pubkey.toLowerCase() === pubkey) ids.add(ev.id)
    }
  }

  return [...ids]
}

/** DELETE one event row on an HTTP index relay. 404 is treated as success. */
export async function deleteEventFromHttpRelay(
  baseUrl: string,
  eventId: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const id = eventId.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(id)) return

  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayEventDeleteUrl(base, id)
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
      timeoutMs: 25_000
    })
    if (res.status === 204 || res.status === 404) return
    if (isDevViteIndexRelayProxyPath(endpoint) && res.status === 500) {
      throw new IndexRelayTransportError()
    }
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  } catch (e) {
    if (e instanceof IndexRelayTransportError) throw e
    if ((e as Error).name === 'AbortError') throw e
    if (isIndexRelayTransportFailure(e)) {
      throw new IndexRelayTransportError(e)
    }
    throw e
  }
}

/**
 * After a signed kind-5 is published to an HTTP index relay, remove referenced rows via DELETE.
 * Caller should tombstone locally first; this only runs for verified kind-5 events.
 */
export async function applyKind5DeletionTargetsToHttpRelay(
  baseUrl: string,
  deletionEvent: NEvent,
  options?: { signal?: AbortSignal }
): Promise<void> {
  if (deletionEvent.kind !== kinds.EventDeletion) return
  if (!verifyEvent(deletionEvent)) {
    logger.warn('[IndexRelayHttp] Skipping HTTP index deletes — kind 5 failed signature verify')
    return
  }

  const targetIds = await resolveKind5DeletionTargetIdsForHttpRelay(baseUrl, deletionEvent, options)
  for (const id of targetIds) {
    try {
      await deleteEventFromHttpRelay(baseUrl, id, options)
    } catch (e) {
      logger.warn('[IndexRelayHttp] HTTP index delete failed', {
        baseUrl,
        eventId: id.slice(0, 12),
        error: e
      })
    }
  }
}
