import { emojis } from '@tiptap/extension-emoji'
import customEmojiService from '@/services/custom-emoji.service'

export const EMOJI_SUGGESTION_MAX_RESULTS = 50
export const STANDARD_EMOJI_SUGGESTION_LIMIT = 25

function customShortcodeMatchesQuery(shortcode: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return shortcode.toLowerCase().includes(q)
}

/** Rank native :shortcode: matches (prefix on shortcode beats tag/name substring). */
export function rankStandardEmojiShortcodes(
  query: string,
  limit = STANDARD_EMOJI_SUGGESTION_LIMIT
): string[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const scored: Array<{ shortcode: string; score: number }> = []
  const seen = new Set<string>()

  const add = (shortcode: string, score: number) => {
    if (!shortcode || seen.has(shortcode)) return
    seen.add(shortcode)
    scored.push({ shortcode, score })
  }

  for (const item of emojis) {
    const shortcodes = item.shortcodes ?? []
    const tags = item.tags ?? []
    const name = (item.name ?? '').toLowerCase()

    for (const raw of shortcodes) {
      const s = String(raw).toLowerCase()
      if (s === q) add(raw, 100)
      else if (s.startsWith(q)) add(raw, 90)
      else if (s.includes(q)) add(raw, 75)
    }

    if (tags.some((t) => String(t).toLowerCase().includes(q))) {
      const sc = shortcodes[0]
      if (sc) add(sc, 50)
    }
    if (name.includes(q)) {
      const sc = shortcodes[0]
      if (sc) add(sc, 40)
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.shortcode.localeCompare(b.shortcode))
    .slice(0, limit)
    .map((x) => x.shortcode)
}

/** Merge custom + standard emoji ids/shortcodes for the composer `:shortcode:` popup. */
export async function buildEmojiSuggestionItems(
  query: string,
  viewerPubkey: string | null | undefined
): Promise<string[]> {
  const q = query.trim()
  const standard = rankStandardEmojiShortcodes(q)

  const rawCustom = await customEmojiService.searchEmojis(q, viewerPubkey ?? null)
  const customIds = q
    ? rawCustom.filter((id) => {
        const sc = customEmojiService.getEmojiById(id)?.shortcode
        return sc && customShortcodeMatchesQuery(sc, q)
      })
    : rawCustom

  const customShortcodes = new Set(
    customIds
      .map((id) => customEmojiService.getEmojiById(id)?.shortcode)
      .filter((s): s is string => Boolean(s))
  )
  const standardUnique = standard.filter((s) => !customShortcodes.has(s))

  if (!q) {
    return [...customIds, ...standardUnique].slice(0, EMOJI_SUGGESTION_MAX_RESULTS)
  }

  return [...standardUnique, ...customIds].slice(0, EMOJI_SUGGESTION_MAX_RESULTS)
}
