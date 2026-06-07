import type { Event } from 'nostr-tools'

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
