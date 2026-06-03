import logger from '@/lib/logger'
import type { Event } from 'nostr-tools'
import { validateEvent, verifyEvent } from 'nostr-tools'

/** Engagement / aggregate fields on API rows — not Nostr event fields. */
const ARCHIVES_ENGAGEMENT_KEYS = new Set([
  'reactions',
  'replies',
  'reposts',
  'zap_sats',
  'count',
  'total_sats',
  'amount_sats',
  'profiles'
  // `event` is a structural wrapper ({ event, reactions, … }), not enrichment — do not strip.
])

/** Strip Archives enrichment fields before treating a row as a Nostr event. */
export function stripArchivesEngagementFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!ARCHIVES_ENGAGEMENT_KEYS.has(k)) out[k] = v
  }
  return out
}

export function isPersistableNostrEventShape(ev: Event): boolean {
  if (!/^[0-9a-f]{64}$/i.test(ev.id)) return false
  if (!/^[0-9a-f]{64}$/i.test(ev.pubkey)) return false
  if (!Number.isFinite(ev.kind) || !Number.isFinite(ev.created_at)) return false
  if (typeof ev.content !== 'string') return false
  if (typeof ev.sig !== 'string' || ev.sig.length < 64) return false
  if (!Array.isArray(ev.tags)) return false
  return true
}

/**
 * Convert an Archives JSON event (full or enriched) into a verified Nostr {@link Event}, or null if invalid.
 */
export function archivesJsonToVerifiedEvent(raw: unknown): Event | null {
  if (!raw || typeof raw !== 'object') return null
  const stripped = stripArchivesEngagementFields(raw as Record<string, unknown>)
  const nested = stripped.event
  const base =
    nested && typeof nested === 'object' ? stripArchivesEngagementFields(nested as Record<string, unknown>) : stripped

  const id = typeof base.id === 'string' ? base.id.toLowerCase() : ''
  const pubkey = typeof base.pubkey === 'string' ? base.pubkey.toLowerCase() : ''
  const kind = typeof base.kind === 'number' ? base.kind : Number(base.kind)
  const created_at = typeof base.created_at === 'number' ? base.created_at : Number(base.created_at)
  if (!Number.isFinite(kind) || !Number.isFinite(created_at)) return null
  const content = typeof base.content === 'string' ? base.content : ''
  const sig = typeof base.sig === 'string' ? base.sig : ''
  const tags = Array.isArray(base.tags) ? (base.tags as Event['tags']) : []

  const candidate = {
    id,
    pubkey,
    kind,
    created_at,
    content,
    sig,
    tags
  } as Event

  if (!isPersistableNostrEventShape(candidate)) return null
  if (!validateEvent(candidate)) return null
  if (!verifyEvent(candidate)) {
    logger.debug('[nostr-archives] skipped unverified event', { id: id.slice(0, 8) })
    return null
  }
  return candidate
}
