import { RANDOM_PUBLISH_RELAY_COUNT } from '@/constants'
import { canonicalRelaySessionKey, normalizeAnyRelayUrl, normalizeRelayUrlByScheme } from '@/lib/url'

export function normalizePublishRelayCandidate(url: string): string {
  return normalizeRelayUrlByScheme(normalizeAnyRelayUrl(url) || url) || url.trim()
}

/**
 * Ordered candidate pool for optional random publish relays (NIP-66 lively, then write fallbacks).
 * Excludes relays already in the user's publish picker list ({@link excludeSessionKeys}).
 */
export function buildRandomPublishRelayCandidateList(args: {
  excludeSessionKeys: ReadonlySet<string>
  sessionBoost: readonly string[]
  nip66Lively: readonly string[]
  fallbackWriteRelays: readonly string[]
  /** Upper bound on candidates before {@link pickRandomPublishRelays} narrows to {@link RANDOM_PUBLISH_RELAY_COUNT}. */
  maxCandidates?: number
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const max = args.maxCandidates ?? RANDOM_PUBLISH_RELAY_COUNT * 8

  const push = (raw: string) => {
    if (out.length >= max) return
    const normalized = normalizePublishRelayCandidate(raw)
    const key = canonicalRelaySessionKey(normalized)
    if (!key || args.excludeSessionKeys.has(key) || seen.has(key)) return
    seen.add(key)
    out.push(normalized)
  }

  for (const u of args.sessionBoost) push(u)
  for (const u of args.nip66Lively) push(u)
  if (out.length < RANDOM_PUBLISH_RELAY_COUNT) {
    for (const u of args.fallbackWriteRelays) push(u)
  }
  return out
}
