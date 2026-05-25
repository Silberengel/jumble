export type NostrSpecAffectedKindRow = { id: string; value: string }

export function newNostrSpecAffectedKindRow(value = ''): NostrSpecAffectedKindRow {
  return { id: crypto.randomUUID(), value }
}

/** Parse kind numbers from composer rows (one kind per line). */
export function parseNostrSpecAffectedKinds(rows: NostrSpecAffectedKindRow[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const row of rows) {
    const raw = row.value.trim()
    if (!raw) continue
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/** Kind numbers from `k` tags on a published Nostr specification (30817). */
export function parseNostrSpecAffectedKindsFromEvent(event: { tags: string[][] }): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'k' || !tag[1]) continue
    const n = Number.parseInt(tag[1], 10)
    if (!Number.isInteger(n) || n < 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out.sort((a, b) => a - b)
}
