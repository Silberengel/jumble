/**
 * HTTP JSON API for index-style relays (e.g. gc_index_relay: POST /api/events/filter, POST /api/events).
 * @see gc_index_relay lib/gc_index_relay_web/router.ex
 *
 * **Local dev:** loopback bases (`http://localhost:*` / `http://127.0.0.1:*`) are automatically fetched via
 * the Vite same-origin proxy `/dev-index-relay` → `VITE_DEV_INDEX_RELAY_TARGET` (default in `vite.config.ts`).
 * Known broken CORS HTTPS hosts (e.g. nos.lol) use `/dev-cors-index-relay` (see `vite.config.ts` + `url.ts`).
 * Production and other remote HTTPS relays still need CORS or your own reverse proxy.
 */
import { ExtendedKind } from '@/constants'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'
import {
  devProxyCorsProblematicHttpsIndexRelayBase,
  devProxyLoopbackHttpRelayBase,
  normalizeHttpRelayUrl
} from '@/lib/url'
import type { Filter, Event as NEvent } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'

function trimSlash(base: string): string {
  return base.replace(/\/+$/, '')
}

function indexRelayFilterUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events/filter`
}

function indexRelayPublishUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/events`
}

function indexRelayPublicationMetadataSearchUrl(baseUrl: string): string {
  return `${trimSlash(normalizeHttpRelayUrl(baseUrl) || baseUrl)}/api/publications/search`
}

/** Map a Nostr filter to gc_index_relay POST body (requires `limit` 1–100; strips unsupported keys). */
function nostrFilterToIndexRelayBody(f: Filter): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const lim = f.limit
  const capped = lim == null || lim < 1 ? 100 : Math.min(100, lim)
  body.limit = capped
  if (f.ids?.length) body.ids = f.ids
  if (f.authors?.length) body.authors = f.authors
  if (f.kinds?.length) body.kinds = f.kinds
  if (f.since != null) body.since = f.since
  if (f.until != null) body.until = f.until
  if (typeof f.search === 'string' && f.search.trim()) {
    body.search = f.search.trim()
  }
  /** Index relays expect NIP-01 lowercase single-letter tag keys (`#e` not `#E`). */
  const tagBuckets = new Map<string, string[]>()
  for (const key of Object.keys(f)) {
    if (key.length !== 2 || !key.startsWith('#')) continue
    const v = (f as Record<string, unknown>)[key]
    if (!Array.isArray(v) || v.length === 0) continue
    const normKey = `#${key[1].toLowerCase()}`
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
 * When the Vite `/dev-index-relay` proxy returns 5xx, skip further dev index HTTP fetches for this tab
 * (same pattern as optional `/sites/` and translate proxies). Cleared on a successful filter response.
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

function markDevIndexRelayUnavailableFromHttpStatus(status: number, endpoint: string): void {
  if (!isDevViteIndexRelayProxyPath(endpoint)) return
  if (status < 500 || status > 599) return
  if (devIndexRelayUnavailableThisSession) return
  devIndexRelayUnavailableThisSession = true
  if (!devIndexRelaySkipLogged) {
    devIndexRelaySkipLogged = true
    logger.debug(
      `[IndexRelayHttp] Dev index relay returned HTTP ${status}; skipping further dev-index-relay fetches this session (other relays continue).`
    )
  }
}

function shouldSkipDevIndexRelayFetch(endpoint: string): boolean {
  return import.meta.env.DEV && devIndexRelayUnavailableThisSession && isDevViteIndexRelayProxyPath(endpoint)
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
            markDevIndexRelayUnavailableFromHttpStatus(res.status, endpoint)
            maybeLogDevIndexRelayHttpErrorHint(res.status, detail || undefined)
          } else {
            logger.debug('[IndexRelayHttp] filter HTTP response', {
              endpoint,
              status: res.status,
              detail: detail || undefined
            })
          }
        } else {
          warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] filter request failed', {
            endpoint,
            status: res.status
          })
        }
        if (res.status >= 500) {
          markDevIndexRelayUnavailableFromHttpStatus(res.status, endpoint)
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
        markDevIndexRelayUnavailableFromHttpStatus(res.status, endpoint)
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
export async function queryIndexRelayPublicationMetadataSearch(
  baseUrl: string,
  query: string,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<TIndexRelayLibraryPage> {
  const q = query.trim()
  if (!q) return { events: [], apiRowCount: 0 }

  const base = devHttpIndexRelayBaseForFetch(baseUrl)
  const endpoint = indexRelayPublicationMetadataSearchUrl(base)
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
      timeoutMs: 25_000
    })
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) return { events: [], apiRowCount: 0 }
      if (res.status >= 500) {
        markDevIndexRelayUnavailableFromHttpStatus(res.status, endpoint)
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
    warnIndexRelayHttpThrottled(endpoint, '[IndexRelayHttp] publication metadata search request error', {
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
