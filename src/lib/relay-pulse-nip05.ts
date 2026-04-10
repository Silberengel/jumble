import type { Event } from 'nostr-tools'

function addNip05(set: Set<string>, raw: unknown) {
  if (typeof raw !== 'string') return
  const t = raw.trim()
  if (t) set.add(t)
}

/**
 * All NIP-05 identifiers from kind 0: every `nip05` tag plus JSON `nip05` (string or string array).
 * Deduplicated, order not preserved.
 */
export function collectAggregatedNip05sFromKind0(event: Event): string[] {
  const set = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] === 'nip05' && tag[1]) addNip05(set, tag[1])
  }
  try {
    const obj = JSON.parse(event.content || '{}') as Record<string, unknown>
    const j = obj.nip05
    if (typeof j === 'string') addNip05(set, j)
    else if (Array.isArray(j)) {
      for (const x of j) addNip05(set, x)
    }
  } catch {
    // ignore invalid JSON
  }
  return [...set]
}
