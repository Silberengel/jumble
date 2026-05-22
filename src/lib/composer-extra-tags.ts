export type ComposerExtraTagRow = { id: string; tag: string[] }

export function newComposerTagRow(tag: string[] = ['', '']): ComposerExtraTagRow {
  return { id: crypto.randomUUID(), tag: [...tag] }
}

/** Normalize user rows into valid Nostr tag arrays (non-empty tag name). */
export function normalizeComposerExtraTags(rows: ComposerExtraTagRow[]): string[][] {
  return rows
    .map((row) => row.tag)
    .filter((tag) => Array.isArray(tag) && String(tag[0] ?? '').trim())
    .map((tag) => [String(tag[0]).trim(), ...tag.slice(1).map((v) => String(v ?? '').trim())])
}

/** Join tag[1..] for a single-line editor (commas in values are preserved via multiline instead). */
export function formatComposerTagValuesInput(tag: string[]): string {
  return tag.slice(1).join('\n')
}

export function parseComposerTagValuesInput(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}
