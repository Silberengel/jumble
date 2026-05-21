/**
 * Tracks pubkeys currently loaded via {@link ReplaceableEventService.fetchProfilesForPubkeys}
 * so per-avatar {@link ReplaceableEventService.fetchProfileEvent} does not open parallel
 * 17-relay fallback REQ storms while a batch is in flight.
 */

const awaitingBatch = new Set<string>()

function norm(pk: string): string {
  return pk.trim().toLowerCase()
}

export function registerProfileBatchPubkeys(pubkeys: readonly string[]): void {
  for (const pk of pubkeys) {
    if (pk.length === 64 && /^[0-9a-f]{64}$/i.test(pk)) {
      awaitingBatch.add(norm(pk))
    }
  }
}

export function unregisterProfileBatchPubkeys(pubkeys: readonly string[]): void {
  for (const pk of pubkeys) {
    awaitingBatch.delete(norm(pk))
  }
}

export function isPubkeyAwaitingProfileBatch(pubkey: string): boolean {
  const pk = norm(pubkey)
  return pk.length === 64 && awaitingBatch.has(pk)
}

export function collectProfilePubkeysFromEvents(
  events: readonly { pubkey: string; tags: string[][] }[],
  maxPTagsPerEvent = 4
): string[] {
  const out = new Set<string>()
  const addPk = (p: string | undefined) => {
    if (p && p.length === 64 && /^[0-9a-f]{64}$/i.test(p)) {
      out.add(norm(p))
    }
  }
  for (const e of events) {
    addPk(e.pubkey)
    let n = 0
    for (const tag of e.tags) {
      if (tag[0] === 'p' && tag[1]) {
        addPk(tag[1])
        n++
        if (n >= maxPTagsPerEvent) break
      }
    }
  }
  return [...out]
}
