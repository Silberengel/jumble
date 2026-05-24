import { ExtendedKind } from '@/constants'
import { buildAttestedPaymentIdSet, findPaymentAttestationForTarget } from '@/lib/superchat'
import { normalizeHexPubkey } from '@/lib/pubkey'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import type { Event as NostrEvent, Filter } from 'nostr-tools'

const attestationByTargetKey = new Map<string, NostrEvent>()
const relayFetchByTargetKey = new Map<string, Promise<NostrEvent[]>>()
const authorHydrateByPubkey = new Map<string, Promise<void>>()

const LOCAL_ATTESTED_KEY_PREFIX = 'jumble:attested-payment-ids:'

/** Kind 9741 events already in the session LRU (for feed attestation index). */
export function collectPaymentAttestationsFromSession(limit = 2000): NostrEvent[] {
  return client.eventService.getSessionEventsMatchingFilters(
    [{ kinds: [ExtendedKind.PAYMENT_ATTESTATION], limit }],
    limit
  )
}

export function paymentAttestationCacheKey(targetEventId: string, recipientPubkey: string): string {
  return `${targetEventId.trim().toLowerCase()}:${recipientPubkey.trim().toLowerCase()}`
}

function readLocalAttestedIds(recipientPubkey: string): Set<string> {
  const pk = normalizeHexPubkey(recipientPubkey)
  if (!/^[0-9a-f]{64}$/.test(pk)) return new Set()
  try {
    const raw = localStorage.getItem(`${LOCAL_ATTESTED_KEY_PREFIX}${pk}`)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim().toLowerCase())
        .filter((id) => /^[0-9a-f]{64}$/.test(id))
    )
  } catch {
    return new Set()
  }
}

/** Durable local record that this payment was attested (survives reloads and relay failures). */
export function markLocalAttestationTarget(recipientPubkey: string, targetEventId: string): void {
  const pk = normalizeHexPubkey(recipientPubkey)
  const targetId = targetEventId.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk) || !/^[0-9a-f]{64}$/.test(targetId)) return
  const ids = readLocalAttestedIds(pk)
  if (ids.has(targetId)) return
  ids.add(targetId)
  try {
    localStorage.setItem(`${LOCAL_ATTESTED_KEY_PREFIX}${pk}`, JSON.stringify([...ids]))
  } catch {
    /* quota */
  }
}

export function isLocallyMarkedAttested(recipientPubkey: string, targetEventId: string): boolean {
  return readLocalAttestedIds(recipientPubkey).has(targetEventId.trim().toLowerCase())
}

/** Synchronous attested payment ids from durable local storage (no network). */
export function readKnownAttestedPaymentTargetsSync(recipientPubkey: string): Set<string> {
  return new Set(readLocalAttestedIds(recipientPubkey))
}

export function mergeAttestedPaymentIdSets(
  base: ReadonlySet<string>,
  incoming: ReadonlySet<string>
): Set<string> {
  const next = new Set(base)
  for (const id of incoming) next.add(id)
  return next
}

function listInMemoryAttestationsForAuthor(recipientPubkey: string): NostrEvent[] {
  const pk = normalizeHexPubkey(recipientPubkey)
  if (!/^[0-9a-f]{64}$/.test(pk)) return []
  const suffix = `:${pk}`
  const out: NostrEvent[] = []
  for (const [key, attestation] of attestationByTargetKey) {
    if (key.endsWith(suffix)) out.push(attestation)
  }
  return out
}

/**
 * Attested payment target ids without awaiting IndexedDB (memory cache, session, verified local marks).
 * Use for first paint; follow with {@link resolveAttestedPaymentIdSet} for a complete set.
 */
export function resolveAttestedPaymentIdSetSync(recipientPubkey: string): Set<string> {
  const pk = normalizeHexPubkey(recipientPubkey)
  if (!/^[0-9a-f]{64}$/.test(pk)) return new Set()

  const attestations: NostrEvent[] = [...listInMemoryAttestationsForAuthor(pk)]
  const seen = new Set(attestations.map((a) => a.id))
  for (const attestation of client.eventService.getSessionEventsMatchingFilters(
    [{ kinds: [ExtendedKind.PAYMENT_ATTESTATION], authors: [pk], limit: 500 }],
    500
  )) {
    if (seen.has(attestation.id)) continue
    seen.add(attestation.id)
    attestations.push(attestation)
  }

  const out = buildAttestedPaymentIdSet(attestations, pk)
  for (const id of readLocalAttestedIds(pk)) {
    if (out.has(id)) continue
    const cached = peekCachedPaymentAttestation(id, pk)
    if (cached?.kind === ExtendedKind.PAYMENT_ATTESTATION) {
      out.add(id)
    }
  }
  return out
}

/** Kind 9735 / 9740 events already in the session LRU (no network). */
export function peekAttestedSuperchatTargetEvents(attestedIds: ReadonlySet<string>): NostrEvent[] {
  const out: NostrEvent[] = []
  const seen = new Set<string>()
  for (const id of attestedIds) {
    const hex = id.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) continue
    const ev = client.peekSessionCachedEvent(hex)
    if (!ev || seen.has(ev.id)) continue
    seen.add(ev.id)
    out.push(ev)
  }
  return out
}

/** Load attested superchat target events: session → local feed → relay (short timeouts when foreground). */
export async function hydrateAttestedSuperchatTargetEvents(
  attestedIds: ReadonlySet<string>,
  relayUrls: string[],
  options: { foreground?: boolean } = {}
): Promise<NostrEvent[]> {
  const ids = [...attestedIds].filter((id) => /^[0-9a-f]{64}$/i.test(id))
  if (ids.length === 0) return []

  const byId = new Map<string, NostrEvent>()
  for (const e of peekAttestedSuperchatTargetEvents(attestedIds)) {
    byId.set(e.id.toLowerCase(), e)
  }

  try {
    const local = await client.getLocalFeedEvents(
      [{ urls: [], filter: { ids, limit: ids.length } }],
      { maxMatches: ids.length }
    )
    for (const e of local) byId.set(e.id.toLowerCase(), e)
  } catch {
    /* optional */
  }

  const missing = ids.filter((id) => !byId.has(id.toLowerCase()))
  if (missing.length > 0 && relayUrls.length > 0) {
    try {
      const fetched = await client.fetchEvents(
        relayUrls,
        { ids: missing, limit: missing.length },
        {
          cache: true,
          foreground: options.foreground,
          eoseTimeout: options.foreground ? 1600 : 4500,
          globalTimeout: options.foreground ? 5000 : 12_000
        }
      )
      for (const e of fetched) byId.set(e.id.toLowerCase(), e)
    } catch {
      /* optional */
    }
  }

  return [...byId.values()]
}

/** Drop durable local marks that are not backed by a cached kind 9741 attestation. */
export function pruneUnverifiedLocalAttestationMarks(recipientPubkey: string): void {
  const pk = normalizeHexPubkey(recipientPubkey)
  if (!/^[0-9a-f]{64}$/.test(pk)) return
  const local = readLocalAttestedIds(pk)
  if (local.size === 0) return
  const verified: string[] = []
  for (const id of local) {
    const cached = peekCachedPaymentAttestation(id, pk)
    if (cached?.kind === ExtendedKind.PAYMENT_ATTESTATION) {
      verified.push(id)
    }
  }
  if (verified.length === local.size) return
  try {
    localStorage.setItem(`${LOCAL_ATTESTED_KEY_PREFIX}${pk}`, JSON.stringify(verified))
  } catch {
    /* quota */
  }
}

/** Attested payment target ids from local storage, IndexedDB, session, and optional relay batch. */
export async function resolveAttestedPaymentIdSet(
  recipientPubkey: string,
  relayAttestations: NostrEvent[] = []
): Promise<Set<string>> {
  const pk = normalizeHexPubkey(recipientPubkey)
  if (!/^[0-9a-f]{64}$/.test(pk)) return new Set()

  const out = new Set<string>()
  await hydrateAttestationsForAuthor(pk)

  const attestations: NostrEvent[] = []
  const seen = new Set<string>()
  const push = (ev: NostrEvent) => {
    if (seen.has(ev.id)) return
    seen.add(ev.id)
    attestations.push(ev)
  }

  for (const attestation of await indexedDb.getPaymentAttestationsForAuthor(pk, 1000)) {
    push(attestation)
  }
  for (const attestation of client.eventService.getSessionEventsMatchingFilters(
    [{ kinds: [ExtendedKind.PAYMENT_ATTESTATION], authors: [pk], limit: 500 }],
    500
  )) {
    push(attestation)
  }
  for (const attestation of relayAttestations) {
    push(attestation)
  }

  for (const id of buildAttestedPaymentIdSet(attestations, pk)) {
    out.add(id)
  }

  // Keep durable local marks only when they match a verified attestation target.
  for (const id of readLocalAttestedIds(pk)) {
    if (out.has(id)) continue
    const cached = peekCachedPaymentAttestation(id, pk)
    if (cached && cached.kind === ExtendedKind.PAYMENT_ATTESTATION) {
      out.add(id)
    }
  }

  return out
}

export function peekCachedPaymentAttestation(
  targetEventId: string,
  recipientPubkey: string
): NostrEvent | undefined {
  return attestationByTargetKey.get(paymentAttestationCacheKey(targetEventId, recipientPubkey))
}

export function rememberPaymentAttestation(
  targetEventId: string,
  recipientPubkey: string,
  attestation: NostrEvent
): void {
  attestationByTargetKey.set(
    paymentAttestationCacheKey(targetEventId, recipientPubkey),
    attestation
  )
  markLocalAttestationTarget(recipientPubkey, targetEventId)
}

export function resolvePaymentAttestationFromEvents(
  events: NostrEvent[],
  targetEventId: string,
  recipientPubkey: string
): NostrEvent | undefined {
  const match = findPaymentAttestationForTarget(events, targetEventId, recipientPubkey)
  if (match) {
    rememberPaymentAttestation(targetEventId, recipientPubkey, match)
  }
  return match
}

/** Load all known attestations by this author into the in-memory cache (once per session). */
export async function hydrateAttestationsForAuthor(authorPubkey: string): Promise<void> {
  const pk = normalizeHexPubkey(authorPubkey)
  if (!/^[0-9a-f]{64}$/.test(pk)) return

  let inflight = authorHydrateByPubkey.get(pk)
  if (!inflight) {
    inflight = (async () => {
      const idbAttestations = await indexedDb.getPaymentAttestationsForAuthor(pk, 1000)
      for (const attestation of idbAttestations) {
        rememberPaymentAttestationFromPublish(attestation)
      }

      const sessionHits = client.eventService.getSessionEventsMatchingFilters(
        [{ kinds: [ExtendedKind.PAYMENT_ATTESTATION], authors: [pk], limit: 500 }],
        500
      )
      for (const attestation of sessionHits) {
        rememberPaymentAttestationFromPublish(attestation)
      }
      pruneUnverifiedLocalAttestationMarks(pk)
    })().finally(() => {
      if (authorHydrateByPubkey.get(pk) === inflight) {
        authorHydrateByPubkey.delete(pk)
      }
    })
    authorHydrateByPubkey.set(pk, inflight)
  }
  await inflight
}

export async function loadPaymentAttestationLocal(
  targetEventId: string,
  recipientPubkey: string,
  filter: Filter
): Promise<NostrEvent | undefined> {
  const cached = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  if (cached) return cached

  if (isLocallyMarkedAttested(recipientPubkey, targetEventId)) {
    await hydrateAttestationsForAuthor(recipientPubkey)
    const hydrated = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
    if (hydrated) return hydrated
  }

  await hydrateAttestationsForAuthor(recipientPubkey)
  const afterHydrate = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  if (afterHydrate) return afterHydrate

  const sessionHits = client.eventService.getSessionEventsMatchingFilters([filter], 5)
  const fromSession = resolvePaymentAttestationFromEvents(sessionHits, targetEventId, recipientPubkey)
  if (fromSession) return fromSession

  const idbAttestations = await indexedDb.getPaymentAttestationsForTargetEvent(targetEventId, 20)
  return resolvePaymentAttestationFromEvents(idbAttestations, targetEventId, recipientPubkey)
}

/** One coalesced relay refresh per payment target (shared by all visible superchat rows). */
export async function refreshPaymentAttestationFromRelays(
  targetEventId: string,
  recipientPubkey: string,
  filter: Filter
): Promise<NostrEvent | undefined> {
  const cached = peekCachedPaymentAttestation(targetEventId, recipientPubkey)
  if (cached) return cached

  const key = paymentAttestationCacheKey(targetEventId, recipientPubkey)
  let inflight = relayFetchByTargetKey.get(key)
  if (!inflight) {
    inflight = client
      .fetchEvents([], filter, {
        cache: true,
        eoseTimeout: 2500,
        globalTimeout: 6000
      })
      .finally(() => {
        if (relayFetchByTargetKey.get(key) === inflight) {
          relayFetchByTargetKey.delete(key)
        }
      })
    relayFetchByTargetKey.set(key, inflight)
  }

  const relayAttestations = await inflight
  return resolvePaymentAttestationFromEvents(relayAttestations, targetEventId, recipientPubkey)
}

export function rememberPaymentAttestationFromPublish(attestation: NostrEvent): void {
  if (attestation.kind !== ExtendedKind.PAYMENT_ATTESTATION) return
  const targetId = attestation.tags
    .find(([name]) => name === 'e' || name === 'E')?.[1]
    ?.trim()
    .toLowerCase()
  if (!targetId || !/^[0-9a-f]{64}$/.test(targetId)) return
  rememberPaymentAttestation(targetId, attestation.pubkey, attestation)
}
