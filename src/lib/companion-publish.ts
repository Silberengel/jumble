import { EMBEDDED_EVENT_REGEX } from '@/lib/content-patterns'
import { relayHintWssUrlsFromEvent } from '@/lib/event'
import { findTrailingStringifiedNostrEvent } from '@/lib/nostr-event-json'
import client from '@/services/client.service'
import type { TPublishEventExtras } from '@/types'
import { nip19, type Event } from 'nostr-tools'

export const COMPANION_PUBLISH_CAP = 5

type CompanionRef =
  | { tier: 'embedded'; hexId: string }
  | { tier: 'embedded'; nip19: string }
  | { tier: 'embedded'; inline: Event }
  | { tier: 'q'; hexId: string }
  | { tier: 'q'; coordinate: string }
  | { tier: 'a'; hexId: string }
  | { tier: 'a'; coordinate: string }
  | { tier: 'e'; hexId: string }

function normalizeHex(id: string | undefined): string | undefined {
  if (!id) return undefined
  const t = id.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(t) ? t : undefined
}

function parseQOrATagValue(raw: string | undefined): { hexId?: string; coordinate?: string } | undefined {
  if (raw == null) return undefined
  let s0 = raw.trim()
  if (s0.toLowerCase().startsWith('nostr:')) s0 = s0.slice(6).trim()
  if (!s0) return undefined

  const hex = normalizeHex(s0)
  if (hex) return { hexId: hex }

  const coordMatch = /^(\d+):([0-9a-f]{64}):(.*)$/i.exec(s0)
  if (coordMatch) {
    return {
      coordinate: `${Number(coordMatch[1])}:${coordMatch[2].toLowerCase()}:${coordMatch[3]}`
    }
  }

  if (/^n(?:ote|event|addr)1/i.test(s0)) {
    try {
      const { type, data } = nip19.decode(s0)
      if (type === 'note') return { hexId: normalizeHex(typeof data === 'string' ? data : (data as { id?: string }).id) }
      if (type === 'nevent') return { hexId: normalizeHex((data as { id: string }).id) }
      if (type === 'naddr') {
        const d = data as { kind: number; pubkey: string; identifier: string }
        return {
          coordinate: `${d.kind}:${d.pubkey.toLowerCase()}:${d.identifier ?? ''}`
        }
      }
    } catch {
      /* ignore */
    }
  }

  return undefined
}

function collectEmbeddedRefsFromContent(ev: Event, out: CompanionRef[]): void {
  for (const full of ev.content.match(EMBEDDED_EVENT_REGEX) ?? []) {
    const colon = full.indexOf(':')
    if (colon < 0) continue
    const bech32 = full.slice(colon + 1)
    try {
      const { type, data } = nip19.decode(bech32)
      if (type === 'note') {
        const hex = normalizeHex(typeof data === 'string' ? data : (data as { id?: string }).id)
        if (hex) out.push({ tier: 'embedded', hexId: hex })
      } else if (type === 'nevent') {
        const hex = normalizeHex((data as { id: string }).id)
        if (hex) out.push({ tier: 'embedded', hexId: hex })
      } else if (type === 'naddr') {
        out.push({ tier: 'embedded', nip19: bech32 })
      }
    } catch {
      /* ignore */
    }
  }

  const trailing = findTrailingStringifiedNostrEvent(ev.content)
  if (trailing) {
    out.push({ tier: 'embedded', inline: trailing.event })
    collectEmbeddedRefsFromContent(trailing.event, out)
  }
}

/** Ordered refs: embedded (content + trailing JSON), then all `q`, then `a`, then `e`. */
export function collectCompanionRefsInPublishOrder(event: Event): CompanionRef[] {
  const embedded: CompanionRef[] = []
  const qRefs: CompanionRef[] = []
  const aRefs: CompanionRef[] = []
  const eRefs: CompanionRef[] = []

  collectEmbeddedRefsFromContent(event, embedded)

  for (const tag of event.tags) {
    const name = tag[0]
    if (name === 'q' || name === 'Q') {
      const parsed = parseQOrATagValue(tag[1])
      if (parsed?.hexId) qRefs.push({ tier: 'q', hexId: parsed.hexId })
      else if (parsed?.coordinate) qRefs.push({ tier: 'q', coordinate: parsed.coordinate })
      continue
    }
    if (name === 'a' || name === 'A') {
      const snap = normalizeHex(tag[3])
      if (snap) {
        aRefs.push({ tier: 'a', hexId: snap })
        continue
      }
      const parsed = parseQOrATagValue(tag[1])
      if (parsed?.hexId) aRefs.push({ tier: 'a', hexId: parsed.hexId })
      else if (parsed?.coordinate) aRefs.push({ tier: 'a', coordinate: parsed.coordinate })
      continue
    }
    if (name === 'e' || name === 'E') {
      const hex = normalizeHex(tag[1])
      if (hex) eRefs.push({ tier: 'e', hexId: hex })
    }
  }

  return [...embedded, ...qRefs, ...aRefs, ...eRefs]
}

/**
 * Resolve referenced events for companion republish (boost target, quotes, replies with embeds).
 * Order preserved: embedded → q → a → e; capped at {@link COMPANION_PUBLISH_CAP}.
 */
export async function resolveCompanionEventsForPublish(
  source: Event,
  opts?: { excludeIds?: string[] }
): Promise<Event[]> {
  const exclude = new Set(
    [source.id, ...(opts?.excludeIds ?? [])].map((id) => id.trim().toLowerCase()).filter(Boolean)
  )
  const relayHints = relayHintWssUrlsFromEvent(source)
  const fetchOpts = relayHints.length > 0 ? { relayHints } : undefined

  const refs = collectCompanionRefsInPublishOrder(source)
  const resolved: Event[] = []
  const seen = new Set<string>()

  const tryAdd = (ev: Event | undefined) => {
    if (!ev) return false
    const k = ev.id.toLowerCase()
    if (exclude.has(k) || seen.has(k)) return false
    seen.add(k)
    resolved.push(ev)
    return resolved.length >= COMPANION_PUBLISH_CAP
  }

  const resolveRef = async (ref: CompanionRef): Promise<Event | undefined> => {
    if ('inline' in ref) return ref.inline
    if ('nip19' in ref) {
      try {
        return await client.fetchEvent(ref.nip19, fetchOpts)
      } catch {
        return undefined
      }
    }
    if ('coordinate' in ref) {
      try {
        return await client.fetchEvent(ref.coordinate, fetchOpts)
      } catch {
        return undefined
      }
    }
    if ('hexId' in ref) {
      try {
        return await client.fetchEvent(ref.hexId, fetchOpts)
      } catch {
        return undefined
      }
    }
    return undefined
  }

  for (const ref of refs) {
    if (resolved.length >= COMPANION_PUBLISH_CAP) break
    if ('inline' in ref) {
      if (tryAdd(ref.inline)) break
      continue
    }
    if ('hexId' in ref) {
      const k = ref.hexId
      if (exclude.has(k) || seen.has(k)) continue
    }
    const ev = await resolveRef(ref)
    if (tryAdd(ev)) break
  }

  return resolved
}

/** Fire-and-forget friendly: publish companions to the same relays; never throws. */
export async function publishCompanionEventsBestEffort(
  relayUrls: string[],
  companions: readonly Event[],
  extras: TPublishEventExtras
): Promise<void> {
  if (!relayUrls.length || !companions.length) return

  for (const companion of companions) {
    try {
      await client.publishEvent(relayUrls, companion, {
        ...extras,
        publishBatchLabel: 'companion'
      })
    } catch {
      /* best-effort */
    }
  }
}
