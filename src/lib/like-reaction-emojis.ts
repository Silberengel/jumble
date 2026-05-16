import type { TEmoji } from '@/types'

/**
 * Single source for the quick-like emoji row used by the EmojiPicker / LikeButton.
 * EmojiPicker re-exports this list as EMOJI_PICKER_REACTIONS for LikeButton.
 */

/** NIP-25 default positive reaction is the character `+`, not a Unicode heart. */
export const DEFAULT_LIKE_REACTION_CONTENT = '+' as const

/**
 * Visual glyph for {@link DEFAULT_LIKE_REACTION_CONTENT} in UI (heart suit, emoji presentation).
 * Published reaction content stays `+`.
 */
export const DEFAULT_LIKE_REACTION_DISPLAY_EMOJI = '\u2665\uFE0F'

export const DEFAULT_SUGGESTED_EMOJIS = [
  DEFAULT_LIKE_REACTION_CONTENT,
  '👍',
  '🔥',
  '😂',
  '😢',
  '🫂',
  '🚀'
] as const

/** Kind-7 bodies many clients publish instead of NIP-25 `+`. */
const COMMON_HEART_LIKE_GLYPHS = new Set([
  '❤',
  '❤️',
  '♥',
  '♥️',
  '🩷',
  '🧡',
  '💛',
  '💚',
  '💙',
  '🩵',
  '💜',
  '🤎',
  '🖤',
  '🩶',
  '🤍'
])

const THUMBS_UP_GLYPHS = new Set(['👍', '+1'])
const THUMBS_DOWN_GLYPHS = new Set(['👎', '-1'])
const ARROW_UP_GLYPHS = new Set(['⬆', '⬆️', '↑', '🔼'])
const ARROW_DOWN_GLYPHS = new Set(['⬇', '⬇️', '↓', '🔽'])

const HEART_LIKE_SHORTCODES = new Set(['', '+', 'heart', 'love', 'plus'])
const THUMBS_UP_SHORTCODES = new Set(['thumbsup', 'thumbs_up', '+1', 'like', 'thumbup'])
const THUMBS_DOWN_SHORTCODES = new Set(['thumbsdown', 'thumbs_down', '-1', 'thumbdown'])
const ARROW_UP_SHORTCODES = new Set(['arrow_up', 'arrowup', 'up', 'upvote', 'up_arrow'])
const ARROW_DOWN_SHORTCODES = new Set(['arrow_down', 'arrowdown', 'down', 'downvote', 'down_arrow'])
const DISLIKE_SHORTCODES = new Set(['dislike'])

function normalizedReactionString(emoji: TEmoji | string): string | undefined {
  if (typeof emoji === 'object' && emoji !== null && 'shortcode' in emoji) {
    return emoji.shortcode.trim().toLowerCase()
  }
  if (typeof emoji === 'string') return emoji.trim()
  return undefined
}

function normalizedGlyph(s: string): string {
  return s.normalize('NFC').replace(/\ufe0f/gi, '').trim()
}

function matchesGlyphSet(raw: string, glyphs: Set<string>): boolean {
  const c = raw.trim()
  if (glyphs.has(c)) return true
  const n = normalizedGlyph(c)
  for (const g of glyphs) {
    if (normalizedGlyph(g) === n) return true
  }
  return false
}

function matchesShortcodeSet(
  emoji: TEmoji | string,
  normalized: string,
  codes: Set<string>
): boolean {
  if (typeof emoji === 'object' && emoji !== null && 'shortcode' in emoji) {
    return codes.has(normalized)
  }
  return false
}

function isHeartOrPlusLike(emoji: TEmoji | string): boolean {
  if (typeof emoji === 'object' && emoji !== null && 'shortcode' in emoji) {
    return HEART_LIKE_SHORTCODES.has(emoji.shortcode.trim().toLowerCase())
  }
  if (typeof emoji !== 'string') return false
  const c = emoji.trim()
  return c === '' || c === DEFAULT_LIKE_REACTION_CONTENT || COMMON_HEART_LIKE_GLYPHS.has(c)
}

function isThumbsUp(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, THUMBS_UP_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, THUMBS_UP_GLYPHS)
  return false
}

function isThumbsDown(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, THUMBS_DOWN_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, THUMBS_DOWN_GLYPHS)
  return false
}

function isArrowUp(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, ARROW_UP_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, ARROW_UP_GLYPHS)
  return false
}

function isArrowDown(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, ARROW_DOWN_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, ARROW_DOWN_GLYPHS)
  return false
}

function isDislike(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, DISLIKE_SHORTCODES)) return true
  if (typeof emoji === 'string' && normalized.toLowerCase() === 'dislike') return true
  return false
}

/**
 * Generic positive/negative reactions (hearts, +, thumbs, arrows, explicit dislike) — counted in
 * note stats only; not rendered as separate thread rows.
 */
export function isGenericStatsReactionEmoji(emoji: TEmoji | string): boolean {
  return (
    isHeartOrPlusLike(emoji) ||
    isThumbsUp(emoji) ||
    isThumbsDown(emoji) ||
    isArrowUp(emoji) ||
    isArrowDown(emoji) ||
    isDislike(emoji)
  )
}

export function isGenericStatsReactionContent(content: string): boolean {
  return isGenericStatsReactionEmoji(content)
}

/** @deprecated Use {@link isGenericStatsReactionContent}. */
export const isLowEffortCollapsedReactionContent = isGenericStatsReactionContent
