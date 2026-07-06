/**
 * Reaction Clips (draft NIP, kind 1090): content-addressed short animated media ("GIFs").
 *
 * A clip is a regular, immutable event whose identity is the sha256 of the media bytes,
 * carried both inside the NIP-92 `imeta` tag and as a relay-indexed top-level `x` tag.
 * Emotion labels use NIP-32 (`L`/`l` in the `emotion` namespace, 1–6 per clip).
 */

import { ExtendedKind } from '@/constants'
import type { TDraftEvent } from '@/types'

/** Starter emotion vocabulary from the draft spec (lowercase, flat, all equal). */
export const REACTION_CLIP_EMOTIONS = [
  'joy',
  'laughter',
  'love',
  'sadness',
  'anger',
  'disbelief',
  'fear',
  'surprise',
  'awkward',
  'celebration',
  'approval',
  'disapproval'
] as const

export const REACTION_CLIP_MAX_EMOTIONS = 6
export const REACTION_CLIP_LABEL_NAMESPACE = 'emotion'

export type ReactionClipDraftInput = {
  url: string
  /** sha256 hex of the media bytes (REQUIRED by the spec — the clip's identity). */
  sha256: string
  mimeType?: string
  /** "WxH" */
  dim?: string
  /** Bytes. */
  size?: number
  /** Searchable caption; also used as `alt`. */
  description?: string
  /** 1–6 emotion labels; values outside {@link REACTION_CLIP_EMOTIONS} are allowed but discouraged. */
  emotions: readonly string[]
}

function descriptionTopicTokens(description: string): string[] {
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

/** Lowercased, deduped, capped emotion labels; empty result means the clip cannot be published as kind 1090. */
export function normalizeClipEmotions(emotions: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of emotions) {
    const e = raw.trim().toLowerCase()
    if (!e || seen.has(e)) continue
    seen.add(e)
    out.push(e)
    if (out.length >= REACTION_CLIP_MAX_EMOTIONS) break
  }
  return out
}

/**
 * Kind 1090 reaction clip draft. Throws if `sha256` is missing/malformed or no emotion is given —
 * callers should fall back to a legacy kind 1063 publish in that case.
 */
export function buildReactionClipDraft(input: ReactionClipDraftInput): TDraftEvent {
  const sha256 = input.sha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error('Reaction clip requires the sha256 of the media bytes')
  }
  const emotions = normalizeClipEmotions(input.emotions)
  if (emotions.length === 0) {
    throw new Error('Reaction clip requires at least one emotion label')
  }

  const mimeType = input.mimeType?.trim() || 'image/gif'
  const description = input.description?.trim() ?? ''

  const imeta = ['imeta', `url ${input.url}`, `m ${mimeType}`, `x ${sha256}`]
  if (input.dim?.trim()) imeta.push(`dim ${input.dim.trim()}`)
  if (input.size && input.size > 0) imeta.push(`size ${input.size}`)
  if (description) imeta.push(`alt ${description}`)

  const tags: string[][] = [
    imeta,
    ['x', sha256],
    ['L', REACTION_CLIP_LABEL_NAMESPACE],
    ...emotions.map((e) => ['l', e, REACTION_CLIP_LABEL_NAMESPACE]),
    ['alt', description ? `Reaction clip: ${description}` : 'Reaction clip']
  ]
  for (const topic of descriptionTopicTokens(description)) {
    tags.push(['t', topic])
  }

  return {
    kind: ExtendedKind.REACTION_CLIP,
    content: description,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  }
}

/** Emotion labels (`l` tags in the `emotion` namespace) from event tags. */
export function clipEmotionsFromTags(tags: readonly string[][]): string[] {
  return normalizeClipEmotions(
    tags
      .filter((t) => t[0] === 'l' && t[1]?.trim() && t[2] === REACTION_CLIP_LABEL_NAMESPACE)
      .map((t) => t[1]!)
  )
}

/** Content-addressed URL (e.g. Blossom): 64-hex filename is the sha256 of the bytes. */
export function sha256FromContentAddressedUrl(url: string): string | null {
  try {
    const filename = new URL(url).pathname.split('/').pop() ?? ''
    const stem = filename.includes('.') ? filename.slice(0, filename.indexOf('.')) : filename
    return /^[0-9a-f]{64}$/i.test(stem) ? stem.toLowerCase() : null
  } catch {
    return null
  }
}

const HASH_FETCH_TIMEOUT_MS = 30_000
const HASH_FETCH_MAX_BYTES = 25 * 1024 * 1024

export type HashedRemoteMedia = {
  sha256: string
  size: number
  mimeType?: string
}

export type RemoteMediaBytes = {
  buf: ArrayBuffer
  mimeType?: string
}

async function fetchMediaBytesOnce(fetchUrl: string): Promise<RemoteMediaBytes | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HASH_FETCH_TIMEOUT_MS)
  try {
    // no-store: the image was usually loaded via <img> first (request without an Origin header).
    // CDNs like Tenor cache that CORS-header-less response; a plain cors fetch then gets the
    // poisoned cache entry and fails with a CORS error even though the CDN supports CORS.
    const res = await fetch(fetchUrl, { signal: controller.signal, mode: 'cors', cache: 'no-store' })
    if (!res.ok) return null
    const declaredSize = Number(res.headers.get('content-length') ?? 0)
    if (declaredSize > HASH_FETCH_MAX_BYTES) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > HASH_FETCH_MAX_BYTES) return null
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || undefined
    return { buf, mimeType }
  } finally {
    clearTimeout(timer)
  }
}

/** Same URL with a throwaway query param, to dodge cache entries `cache: 'no-store'` cannot bypass. */
function withCacheBuster(url: string): string | null {
  try {
    const u = new URL(url)
    u.searchParams.set('imwald_cb', Date.now().toString(36))
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Fetch remote media bytes (for mirroring a pasted / third-party URL to the user's media server).
 * Returns null on any failure (CORS, timeout, oversize).
 */
export async function fetchRemoteMediaBytes(url: string): Promise<RemoteMediaBytes | null> {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const media = await fetchMediaBytesOnce(url)
    if (media) return media
  } catch {
    // Retry below with a cache-busting query param — some browsers serve the CORS-less <img>
    // cache entry to a cors fetch regardless of `Vary: Origin` / `cache: 'no-store'`.
  }
  const busted = withCacheBuster(url)
  if (busted) {
    try {
      return await fetchMediaBytesOnce(busted)
    } catch {
      // fall through
    }
  }
  return null
}

/**
 * Fetch remote media bytes and sha256 them (for publishing a clip from a pasted / third-party URL).
 * Returns null on any failure (CORS, timeout, oversize) — callers fall back to a legacy publish.
 */
export async function fetchAndHashMediaUrl(url: string): Promise<HashedRemoteMedia | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const media = await fetchRemoteMediaBytes(url)
  if (!media) {
    const fromUrl = sha256FromContentAddressedUrl(url)
    return fromUrl ? { sha256: fromUrl, size: 0 } : null
  }
  const digest = await crypto.subtle.digest('SHA-256', media.buf)
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { sha256, size: media.buf.byteLength, mimeType: media.mimeType }
}
