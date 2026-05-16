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

export const THUMBS_UP_DISPLAY_EMOJI = '\u{1F44D}' as const
export const THUMBS_DOWN_DISPLAY_EMOJI = '\u{1F44E}' as const
export const ARROW_UP_DISPLAY_EMOJI = '\u2B06\uFE0F' as const
export const ARROW_DOWN_DISPLAY_EMOJI = '\u2B07\uFE0F' as const

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
/** NIP-30 shortcode only — not 💔 (sympathy/sadness, not a downvote). */
const DISLIKE_SHORTCODES = new Set(['dislike'])

function normalizedReactionString(emoji: TEmoji | string): string | undefined {
  if (typeof emoji === 'object' && emoji !== null && 'shortcode' in emoji) {
    return emoji.shortcode.trim().toLowerCase()
  }
  if (typeof emoji === 'string') return emoji.trim()
  return undefined
}

/** Strip emoji presentation selectors so ⬆️ matches ⬆. */
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

export function isHeartOrPlusLikeReactionEmoji(emoji: TEmoji | string): boolean {
  if (typeof emoji === 'object' && emoji !== null && 'shortcode' in emoji) {
    return HEART_LIKE_SHORTCODES.has(emoji.shortcode.trim().toLowerCase())
  }
  if (typeof emoji !== 'string') return false
  const c = emoji.trim()
  return c === '' || c === DEFAULT_LIKE_REACTION_CONTENT || COMMON_HEART_LIKE_GLYPHS.has(c)
}

export function isThumbsUpReactionEmoji(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, THUMBS_UP_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, THUMBS_UP_GLYPHS)
  return false
}

export function isThumbsDownReactionEmoji(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, THUMBS_DOWN_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, THUMBS_DOWN_GLYPHS)
  return false
}

export function isArrowUpReactionEmoji(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, ARROW_UP_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, ARROW_UP_GLYPHS)
  return false
}

export function isArrowDownReactionEmoji(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, ARROW_DOWN_SHORTCODES)) return true
  if (typeof emoji === 'string') return matchesGlyphSet(normalized, ARROW_DOWN_GLYPHS)
  return false
}

/** Explicit `dislike` shortcode / content only (not 💔 or 👎). */
export function isDislikeReactionEmoji(emoji: TEmoji | string): boolean {
  const normalized = normalizedReactionString(emoji)
  if (normalized === undefined) return false
  if (matchesShortcodeSet(emoji, normalized, DISLIKE_SHORTCODES)) return true
  if (typeof emoji === 'string' && normalized.toLowerCase() === 'dislike') return true
  return false
}

export function isPositiveLowEffortReactionEmoji(emoji: TEmoji | string): boolean {
  return (
    isHeartOrPlusLikeReactionEmoji(emoji) ||
    isThumbsUpReactionEmoji(emoji) ||
    isArrowUpReactionEmoji(emoji)
  )
}

export function isNegativeLowEffortReactionEmoji(emoji: TEmoji | string): boolean {
  return (
    isThumbsDownReactionEmoji(emoji) ||
    isArrowDownReactionEmoji(emoji) ||
    isDislikeReactionEmoji(emoji)
  )
}

/**
 * Reactions collapsed into {@link ThreadLowEffortStrip} and hidden as thread rows.
 */
export function isLowEffortCollapsedReactionEmoji(emoji: TEmoji | string): boolean {
  return isPositiveLowEffortReactionEmoji(emoji) || isNegativeLowEffortReactionEmoji(emoji)
}

/** @deprecated Prefer {@link isLowEffortCollapsedReactionEmoji}. */
export function isDefaultPlusLikeReactionEmoji(emoji: TEmoji | string): boolean {
  return isLowEffortCollapsedReactionEmoji(emoji)
}

export function isLowEffortCollapsedReactionContent(content: string): boolean {
  return isLowEffortCollapsedReactionEmoji(content)
}

/** @deprecated Prefer {@link isLowEffortCollapsedReactionContent}. */
export function isDefaultPlusLikeReactionContent(content: string): boolean {
  return isLowEffortCollapsedReactionContent(content)
}
