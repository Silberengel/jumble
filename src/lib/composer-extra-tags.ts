export type ComposerExtraTagRow = {
  id: string
  name: string
  /** Raw textarea content; parsed only when exporting tags. */
  valuesRaw: string
}

export function newComposerTagRow(): ComposerExtraTagRow {
  return { id: crypto.randomUUID(), name: '', valuesRaw: '' }
}

export function composerTagRowFromNostrTag(tag: string[]): ComposerExtraTagRow {
  return {
    id: crypto.randomUUID(),
    name: String(tag[0] ?? ''),
    valuesRaw: formatComposerTagValuesInput(tag)
  }
}

/** Normalize user rows into valid Nostr tag arrays (non-empty tag name). */
export function normalizeComposerExtraTags(rows: ComposerExtraTagRow[]): string[][] {
  return rows
    .filter((row) => row.name.trim())
    .map((row) => {
      const vals = parseComposerTagValuesInput(row.valuesRaw)
      return [row.name.trim(), ...vals]
    })
}

/** Join tag[1..] for the values textarea (one value per line). */
export function formatComposerTagValuesInput(tag: string[]): string {
  return tag.slice(1).join('\n')
}

export function parseComposerTagValuesInput(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
