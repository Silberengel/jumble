/**
 * Nostr Archives REST client (https://nostrarchives.com/docs).
 *
 * Cross-cutting rules:
 * - Never throw to callers; return {@link TArchivesApiResult} and let UI use relay/local fallbacks.
 * - Circuit breaker after repeated failures so offline/API-down does not spam requests.
 * - Verified events from responses are written to session cache + IndexedDB via {@link persistArchivesPayloadEvents}.
 */
import {
  NOSTR_ARCHIVES_API_BASE_URL,
  NOSTR_ARCHIVES_API_RATE_LIMIT_PER_MIN
} from '@/constants'
import { persistArchivesPayloadEvents, persistArchivesEventsIfNew } from '@/lib/nostr-archives-ingest'
import { archivesJsonToVerifiedEvent } from '@/lib/nostr-archives-event'
import logger from '@/lib/logger'
import storage from '@/services/local-storage.service'
import type {
  TArchivesApiResult,
  TArchivesInteractionCounts,
  TArchivesNotePageBundle,
  TArchivesProfileMetadata,
  TArchivesSocialGraph
} from '@/types/nostr-archives'
import { LRUCache } from 'lru-cache'
import type { Event } from 'nostr-tools'

const CIRCUIT_FAILURE_THRESHOLD = 2
const CIRCUIT_COOLDOWN_MS = 60_000
const REQUEST_TIMEOUT_MS = 12_000
/** Skip repeat `/v1/events/{id}` lookups after a 404 for this long (event not in archive). */
const ARCHIVES_NOT_FOUND_CACHE_TTL_MS = 30 * 60_000

/** Whether a failed response indicates the Archives API is down (vs. missing data or bad input). */
export function isArchivesApiCircuitFailure(
  reason: 'network' | 'parse' | 'http',
  status?: number
): boolean {
  if (reason === 'network' || reason === 'parse') return true
  if (status == null) return true
  if (status === 404) return false
  if (status >= 500) return true
  return false
}

/** Client-side timeout (`AbortController`) — slow response, not necessarily API down. */
function isFetchAbortError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const rec = err as { name?: unknown; message?: unknown }
  const name = typeof rec.name === 'string' ? rec.name : ''
  const message = typeof rec.message === 'string' ? rec.message : String(err)
  if (name === 'AbortError') return true
  return /operation was aborted|aborted/i.test(message)
}

/** Event id from Archives event lookup paths (`/v1/events/{id}`, interactions, note page). */
export function eventIdFromArchivesApiPath(path: string): string | undefined {
  const base = path.split('?')[0] ?? path
  const event = base.match(/^\/v1\/events\/([0-9a-f]{64})(?:\/interactions)?$/i)
  if (event) return event[1].toLowerCase()
  const page = base.match(/^\/v1\/pages\/note\/([0-9a-f]{64})/i)
  if (page) return page[1].toLowerCase()
  return undefined
}

class NostrArchivesApiService {
  static instance: NostrArchivesApiService

  private requestTimestamps: number[] = []
  private consecutiveFailures = 0
  private circuitOpenUntil = 0
  private availabilityListeners = new Set<() => void>()
  /** Event ids that returned 404 — avoid re-fetching on every thread/feed row. */
  private notFoundEventUntil = new LRUCache<string, number>({ max: 4096 })
  private fetchInFlight = new Map<string, Promise<TArchivesApiResult<unknown>>>()

  constructor() {
    if (!NostrArchivesApiService.instance) {
      NostrArchivesApiService.instance = this
    }
    return NostrArchivesApiService.instance
  }

  isEnabled(): boolean {
    return storage.getUseNostrArchivesApi()
  }

  /** False when disabled, circuit open, or recent failures — callers should hide Archives-only UI. */
  isAvailable(): boolean {
    if (!this.isEnabled()) return false
    if (Date.now() < this.circuitOpenUntil) return false
    return true
  }

  subscribeAvailability(listener: () => void): () => void {
    this.availabilityListeners.add(listener)
    return () => this.availabilityListeners.delete(listener)
  }

  /** Call after `storage.setUseNostrArchivesApi` so hooks re-render. */
  notifySettingsChanged(): void {
    this.notifyAvailability()
  }

  private notifyAvailability(): void {
    this.availabilityListeners.forEach((l) => l())
  }

  private recordSuccess(): void {
    const wasUnavailable = !this.isAvailable()
    this.consecutiveFailures = 0
    this.circuitOpenUntil = 0
    if (wasUnavailable) this.notifyAvailability()
  }

  private recordFailure(): void {
    if (Date.now() < this.circuitOpenUntil) return
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS
      logger.info(
        '[nostr-archives] API paused after repeated errors — relay fallbacks only; retrying automatically',
        { failures: this.consecutiveFailures, retryAfterMs: CIRCUIT_COOLDOWN_MS }
      )
      this.notifyAvailability()
    }
  }

  /** @internal Vitest only — reset circuit breaker and rate-limit window. */
  resetForTests(): void {
    this.requestTimestamps = []
    this.consecutiveFailures = 0
    this.circuitOpenUntil = 0
    this.notFoundEventUntil.clear()
    this.fetchInFlight.clear()
  }

  private isEventNotFoundCached(eventId: string): boolean {
    const exp = this.notFoundEventUntil.get(eventId)
    if (exp == null) return false
    if (Date.now() >= exp) {
      this.notFoundEventUntil.delete(eventId)
      return false
    }
    return true
  }

  private markEventNotFound(eventId: string): void {
    this.notFoundEventUntil.set(eventId, Date.now() + ARCHIVES_NOT_FOUND_CACHE_TTL_MS)
  }

  private fetchCacheKey(path: string, init?: RequestInit): string {
    return `${(init?.method ?? 'GET').toUpperCase()} ${path}`
  }

  private consumeRateLimit(): boolean {
    const now = Date.now()
    const windowStart = now - 60_000
    this.requestTimestamps = this.requestTimestamps.filter((t) => t >= windowStart)
    if (this.requestTimestamps.length >= NOSTR_ARCHIVES_API_RATE_LIMIT_PER_MIN) {
      return false
    }
    this.requestTimestamps.push(now)
    return true
  }

  private async fetchJson(path: string, init?: RequestInit): Promise<TArchivesApiResult<unknown>> {
    if (!this.isEnabled()) {
      return { ok: false, reason: 'disabled' }
    }
    if (Date.now() < this.circuitOpenUntil) {
      return { ok: false, reason: 'circuit_open' }
    }

    const eventId = eventIdFromArchivesApiPath(path)
    if (eventId && this.isEventNotFoundCached(eventId)) {
      return { ok: false, reason: 'not_found', status: 404 }
    }

    const key = this.fetchCacheKey(path, init)
    const inflight = this.fetchInFlight.get(key)
    if (inflight) return inflight

    const promise = this.fetchJsonNetwork(path, init, eventId).finally(() => {
      this.fetchInFlight.delete(key)
    })
    this.fetchInFlight.set(key, promise)
    return promise
  }

  private async fetchJsonNetwork(
    path: string,
    init: RequestInit | undefined,
    eventId: string | undefined
  ): Promise<TArchivesApiResult<unknown>> {
    if (!this.consumeRateLimit()) {
      return { ok: false, reason: 'rate_limited' }
    }

    const url = `${NOSTR_ARCHIVES_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: {
          Accept: 'application/json',
          ...(init?.headers ?? {})
        }
      })
      clearTimeout(timer)

      if (res.status === 404) {
        if (eventId) this.markEventNotFound(eventId)
        logger.debug('[nostr-archives] not indexed in archive (404)', { path })
        return { ok: false, reason: 'not_found', status: 404 }
      }

      if (!res.ok) {
        if (isArchivesApiCircuitFailure('http', res.status)) {
          this.recordFailure()
          logger.warn('[nostr-archives] API error — using relay fallbacks', {
            path,
            status: res.status
          })
        } else {
          logger.debug('[nostr-archives] request rejected', { path, status: res.status })
        }
        return { ok: false, reason: 'http', status: res.status }
      }

      const text = await res.text()
      try {
        const data = text ? JSON.parse(text) : null
        this.recordSuccess()
        return { ok: true, data }
      } catch {
        this.recordFailure()
        logger.warn('[nostr-archives] API returned invalid JSON — using relay fallbacks', {
          path,
          status: res.status
        })
        return { ok: false, reason: 'parse', status: res.status }
      }
    } catch (err) {
      clearTimeout(timer)
      const aborted = isFetchAbortError(err)
      if (aborted) {
        logger.debug('[nostr-archives] request timed out — using relay fallbacks', {
          path,
          timeoutMs: REQUEST_TIMEOUT_MS
        })
        return { ok: false, reason: 'timeout' }
      }
      this.recordFailure()
      logger.warn('[nostr-archives] API unreachable — using relay fallbacks', {
        path,
        message: err instanceof Error ? err.message : String(err)
      })
      return { ok: false, reason: 'network' }
    }
  }

  private async getAndPersist(path: string): Promise<TArchivesApiResult<unknown>> {
    const res = await this.fetchJson(path)
    if (res.ok) {
      void persistArchivesPayloadEvents(res.data).catch(() => {})
    }
    return res
  }

  async getEventInteractions(eventId: string): Promise<TArchivesApiResult<TArchivesInteractionCounts>> {
    const hex = eventId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      return { ok: false, reason: 'parse' }
    }
    const res = await this.fetchJson(`/v1/events/${hex}/interactions`)
    if (!res.ok) return res
    const d = res.data as Record<string, unknown>
    return {
      ok: true,
      data: {
        reactions: Number(d.reactions) || 0,
        replies: Number(d.replies) || 0,
        reposts: Number(d.reposts) || 0,
        zap_sats: Number(d.zap_sats) || 0
      }
    }
  }

  async getSocialGraph(
    pubkey: string,
    opts?: { followsLimit?: number; followersLimit?: number; followsOffset?: number; followersOffset?: number }
  ): Promise<TArchivesApiResult<TArchivesSocialGraph>> {
    const pk = pubkey.trim()
    const q = new URLSearchParams()
    q.set('follows_limit', String(opts?.followsLimit ?? 0))
    q.set('followers_limit', String(opts?.followersLimit ?? 0))
    q.set('follows_offset', String(opts?.followsOffset ?? 0))
    q.set('followers_offset', String(opts?.followersOffset ?? 0))
    const res = await this.fetchJson(`/v1/social/${encodeURIComponent(pk)}?${q}`)
    if (!res.ok) return res
    const d = res.data as Record<string, unknown>
    const mapList = (part: unknown): { count: number; pubkeys: string[] } => {
      const p = part as Record<string, unknown> | undefined
      const pubkeys = Array.isArray(p?.pubkeys)
        ? (p.pubkeys as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      return { count: Number(p?.count) || pubkeys.length, pubkeys }
    }
    return {
      ok: true,
      data: {
        pubkey: typeof d.pubkey === 'string' ? d.pubkey : pk,
        follows: mapList(d.follows),
        followers: mapList(d.followers)
      }
    }
  }

  async getEventById(eventId: string): Promise<TArchivesApiResult<Event>> {
    const hex = eventId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      return { ok: false, reason: 'parse' }
    }
    const res = await this.getAndPersist(`/v1/events/${hex}`)
    if (!res.ok) return res
    const ev = archivesJsonToVerifiedEvent(res.data)
    if (!ev) return { ok: false, reason: 'parse' }
    return { ok: true, data: ev }
  }

  async getNotePage(eventId: string, limit = 50): Promise<TArchivesApiResult<TArchivesNotePageBundle>> {
    const hex = eventId.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      return { ok: false, reason: 'parse' }
    }
    const res = await this.getAndPersist(`/v1/pages/note/${hex}?limit=${Math.min(200, Math.max(1, limit))}`)
    if (!res.ok) return res
    const d = res.data as Record<string, unknown>
    const event = archivesJsonToVerifiedEvent(d.event)
    if (!event) return { ok: false, reason: 'parse' }

    const replies: Event[] = []
    if (Array.isArray(d.replies)) {
      for (const r of d.replies) {
        const ev = archivesJsonToVerifiedEvent(r)
        if (ev) replies.push(ev)
      }
    }
    await persistArchivesEventsIfNew([event, ...replies])

    const interactionsRaw = (d.interactions ?? d) as Record<string, unknown>
    const profiles =
      d.profiles && typeof d.profiles === 'object'
        ? (d.profiles as Record<string, TArchivesProfileMetadata>)
        : {}

    return {
      ok: true,
      data: {
        event,
        replies,
        profiles,
        interactions: {
          reactions: Number(interactionsRaw.reactions) || 0,
          replies: Number(interactionsRaw.replies) || 0,
          reposts: Number(interactionsRaw.reposts) || 0,
          zap_sats: Number(interactionsRaw.zap_sats) || 0
        }
      }
    }
  }

  async searchNotes(params: {
    q?: string
    limit?: number
    offset?: number
    order?: 'newest' | 'oldest' | 'engagement'
    author?: string
  }): Promise<TArchivesApiResult<{ notes: Event[]; total: number }>> {
    const q = new URLSearchParams()
    if (params.q?.trim()) q.set('q', params.q.trim())
    q.set('limit', String(Math.min(100, Math.max(1, params.limit ?? 20))))
    q.set('offset', String(Math.max(0, params.offset ?? 0)))
    if (params.order) q.set('order', params.order)
    if (params.author?.trim()) q.set('author', params.author.trim())

    const res = await this.getAndPersist(`/v1/notes/search?${q}`)
    if (!res.ok) return res
    const d = res.data as Record<string, unknown>
    const notes: Event[] = []
    if (Array.isArray(d.notes)) {
      for (const n of d.notes) {
        const ev = archivesJsonToVerifiedEvent(
          n && typeof n === 'object' && 'event' in (n as object) ? (n as { event: unknown }).event : n
        )
        if (ev) notes.push(ev)
      }
    }
    return { ok: true, data: { notes, total: Number(d.total) || notes.length } }
  }

  async searchGeneral(params: {
    q: string
    type?: 'all' | 'profiles' | 'notes'
    limit?: number
    offset?: number
  }): Promise<
    TArchivesApiResult<{
      profiles: TArchivesProfileMetadata[]
      notes: Event[]
      resolved?: unknown
    }>
  > {
    const q = new URLSearchParams()
    q.set('q', params.q.trim())
    if (params.type) q.set('type', params.type)
    q.set('limit', String(Math.min(100, Math.max(1, params.limit ?? 20))))
    q.set('offset', String(Math.max(0, params.offset ?? 0)))

    const res = await this.getAndPersist(`/v1/search?${q}`)
    if (!res.ok) return res
    const d = res.data as Record<string, unknown>
    if (d.resolved != null) {
      return { ok: true, data: { profiles: [], notes: [], resolved: d.resolved } }
    }

    const profiles = Array.isArray(d.profiles)
      ? (d.profiles as TArchivesProfileMetadata[])
      : []
    const notes: Event[] = []
    if (Array.isArray(d.notes)) {
      for (const n of d.notes) {
        const ev = archivesJsonToVerifiedEvent(n)
        if (ev) notes.push(ev)
      }
    }
    return { ok: true, data: { profiles, notes } }
  }

  async searchSuggest(
    q: string,
    limit = 5
  ): Promise<TArchivesApiResult<{ suggestions: TArchivesProfileMetadata[] }>> {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      return { ok: true, data: { suggestions: [] } }
    }
    const res = await this.fetchJson(
      `/v1/search/suggest?${new URLSearchParams({ q: trimmed, limit: String(Math.min(10, Math.max(1, limit))) })}`
    )
    if (!res.ok) return res
    const d = res.data as Record<string, unknown>
    const suggestions = Array.isArray(d.suggestions)
      ? (d.suggestions as TArchivesProfileMetadata[])
      : []
    return { ok: true, data: { suggestions } }
  }

  async fetchProfilesMetadata(
    pubkeys: readonly string[]
  ): Promise<TArchivesApiResult<{ profiles: TArchivesProfileMetadata[] }>> {
    const list = [...new Set(pubkeys.map((p) => p.trim().toLowerCase()).filter((p) => /^[0-9a-f]{64}$/.test(p)))]
    if (list.length === 0) {
      return { ok: true, data: { profiles: [] } }
    }

    const merged: TArchivesProfileMetadata[] = []
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500)
      const res = await this.fetchJson('/v1/profiles/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkeys: chunk })
      })
      if (!res.ok) return res
      const d = res.data as Record<string, unknown>
      if (Array.isArray(d.profiles)) {
        merged.push(...(d.profiles as TArchivesProfileMetadata[]))
      }
    }
    return { ok: true, data: { profiles: merged } }
  }
}

const nostrArchivesApi = new NostrArchivesApiService()
export default nostrArchivesApi
