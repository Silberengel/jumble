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
