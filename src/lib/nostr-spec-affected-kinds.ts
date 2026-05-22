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
