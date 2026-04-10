import { EMOJI_SHORT_CODE_REGEX } from '@/lib/content-patterns'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'

/**
 * Replaces standard (non-custom) :shortcode: in content with their Unicode emoji
 * so they render correctly in all content fields (preview, feed, note page, etc.).
 * Custom shortcodes (e.g. from event emoji tags) are left as-is so they render via emoji tags.
 */
export function replaceStandardEmojiShortcodesInContent(
  content: string,
  customShortcodes?: Set<string> | string[]
): string {
  const customSet = customShortcodes instanceof Set
    ? customShortcodes
    : new Set(customShortcodes ?? [])
  return content.replace(EMOJI_SHORT_CODE_REGEX, (match, shortcode: string) => {
    const trimmed = shortcode.trim()
    if (customSet.has(trimmed)) return match
    const native = shortcodeToEmoji(trimmed, emojis) ?? shortcodeToEmoji(trimmed.replace(/\s+/g, '_'), emojis)
    return native?.emoji ?? match
  })
}
