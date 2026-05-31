import type { TRelayThreadHeatBubble, TRelayThreadHeatEdge } from '@/lib/relay-thread-heat'

const CACHE_V = 1 as const

export type TRelayThreadHeatMapCacheEnvelope = {
  v: typeof CACHE_V
  /** When the merge finished (ms since epoch). */
  builtAtMs: number
  bubbles: TRelayThreadHeatBubble[]
  /** Links between bubbles (same as live merge); absent in older cache payloads. */
  edges?: TRelayThreadHeatEdge[]
}

/** Stable short digest for SETTINGS key segments (FNV-1a 32-bit). */
export function digestHeatMapKeyPart(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36).padStart(6, '0')
}

export function relayThreadHeatMapSettingKey(
  pubkey: string,
  relayUrls: readonly string[],
  followPubkeys: readonly string[],
  /** Serialized home kind-picker state so cache invalidates when feed filters change. */
  feedFilterKey: string,
  /** Sorted mute pubkeys so cache invalidates when mutes change. */
  muteFingerprint: string
): string {
  const pk = pubkey.trim().toLowerCase()
  const relayKey = digestHeatMapKeyPart([...relayUrls].sort().join('\n'))
  const followKey = digestHeatMapKeyPart(
    [...followPubkeys]
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join('\n')
  )
  const feedKey = digestHeatMapKeyPart(feedFilterKey)
  const muteKey = digestHeatMapKeyPart(muteFingerprint)
  return `relayHeatV${CACHE_V}:${pk}:${relayKey}:${followKey}:${feedKey}:${muteKey}`
}

export function parseRelayThreadHeatMapCache(raw: string | null): TRelayThreadHeatMapCacheEnvelope | null {
  if (raw == null || raw === '') return null
  try {
    const o = JSON.parse(raw) as Partial<TRelayThreadHeatMapCacheEnvelope>
    if (o.v !== CACHE_V || !Array.isArray(o.bubbles)) return null
    const edgesRaw = o.edges
    const edges: TRelayThreadHeatEdge[] | undefined = Array.isArray(edgesRaw)
      ? edgesRaw.filter(
          (e: unknown): e is TRelayThreadHeatEdge =>
            e != null &&
            typeof (e as TRelayThreadHeatEdge).a === 'string' &&
            typeof (e as TRelayThreadHeatEdge).b === 'string'
        )
      : undefined
    return { v: CACHE_V, builtAtMs: typeof o.builtAtMs === 'number' ? o.builtAtMs : 0, bubbles: o.bubbles, edges }
  } catch {
    return null
  }
}

export function serializeRelayThreadHeatMapCache(envelope: TRelayThreadHeatMapCacheEnvelope): string {
  return JSON.stringify(envelope)
}
