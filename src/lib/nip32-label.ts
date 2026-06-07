import type { Event } from 'nostr-tools'

/** NIP-32 `l` tag value for user-curated publication lists (namespace `ugc`). */
export const NIP32_BOOKLIST_LABEL = 'booklist'

/** NIP-32 namespace for user-generated labels (e.g. booklist). */
export const NIP32_UGC_NAMESPACE = 'ugc'

export function isBooklistNip32Label(label: string): boolean {
  return label.trim().toLowerCase() === NIP32_BOOKLIST_LABEL
}

export function labelEventHasBooklistTag(event: Pick<Event, 'tags'>): boolean {
  return extractNip32LabelValues(event.tags).some(isBooklistNip32Label)
}

/** NIP-32 lowercase `l` tag values (actual labels), not uppercase `L` namespace declarations. */
export function extractNip32LabelValues(tags: string[][]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    if (tag[0] !== 'l') continue
    const value = tag[1]?.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** One-line display text for a kind-1985 label event. */
export function formatNip32LabelSnippet(event: Event, maxLen = 96): string {
  const values = extractNip32LabelValues(event.tags)
  if (values.length > 0) {
    const joined = values.join(' · ')
    if (joined.length <= maxLen) return joined
    return `${joined.slice(0, maxLen - 1).trimEnd()}…`
  }
  const content = event.content?.trim()
  if (content) {
    if (content.length <= maxLen) return content
    return `${content.slice(0, maxLen - 1).trimEnd()}…`
  }
  return ''
}
