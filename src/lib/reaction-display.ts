import { DEFAULT_LIKE_REACTION_CONTENT } from '@/lib/like-reaction-emojis'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { isNip25ReactionKind } from '@/lib/event'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { TEmoji } from '@/types'
import { Event } from 'nostr-tools'

/** Whole-string :shortcode: (NIP-style); matches content-patterns rules. */
const WHOLE_SHORTCODE = /^:([a-zA-Z0-9_\-][^:]{0,19}):$/

export type TReactionEmojiSync =
  | { mode: 'display'; value: TEmoji | string }
  | { mode: 'profile'; shortcode: string; placeholder: string }

function findEmojiByShortcode(infos: readonly TEmoji[], shortcode: string): TEmoji | undefined {
  const lower = shortcode.toLowerCase()
  return infos.find((e) => e.shortcode === shortcode || e.shortcode.toLowerCase() === lower)
}

/** True when the reaction glyph must be resolved from the reactor’s NIP-30 inventory. */
export function reactionNeedsAuthorEmojiLookup(event: Event): boolean {
  return resolveReactionEmojiSync(event, 64).mode === 'profile'
}

/** Collect reactor pubkeys whose custom reaction emoji should be prefetched for feed/notification rows. */
export function collectReactionAuthorPubkeysForEmojiPrefetch(
  events: readonly Event[],
  candidates: Set<string>
): void {
  for (const e of events) {
    if (!reactionNeedsAuthorEmojiLookup(e)) continue
    const pk = e.pubkey?.trim().toLowerCase()
    if (pk && /^[0-9a-f]{64}$/.test(pk)) candidates.add(pk)
  }
}

/**
 * Resolve reaction display without network: emoji tags on the reaction, standard :shortcode: → Unicode,
 * or defer to profile (reactor kind 0) for custom shortcodes.
 */
export function resolveReactionEmojiSync(event: Event, maxRawLength: number): TReactionEmojiSync {
  if (!isNip25ReactionKind(event.kind)) {
    return { mode: 'display', value: '' }
  }

  const raw = event.content?.trim() ?? ''
  if (!raw) {
    return { mode: 'display', value: DEFAULT_LIKE_REACTION_CONTENT }
  }
  if (raw.length > maxRawLength) {
    return { mode: 'display', value: `${raw.slice(0, maxRawLength)}…` }
  }

  const fromReactionTags = getEmojiInfosFromEmojiTags(event.tags)
  const customShortcodes = fromReactionTags.map((e) => e.shortcode)

  if (/^https?:\/\//i.test(raw)) {
    const hit = fromReactionTags.find((e) => e.url === raw)
    if (hit) return { mode: 'display', value: hit }
  }

  if (fromReactionTags.length === 1 && raw === fromReactionTags[0].shortcode) {
    return { mode: 'display', value: fromReactionTags[0] }
  }

  const whole = raw.match(WHOLE_SHORTCODE)
  if (whole) {
    const shortcode = whole[1]
    const hit = findEmojiByShortcode(fromReactionTags, shortcode)
    if (hit) {
      return { mode: 'display', value: hit }
    }
  }

  const normalized = replaceStandardEmojiShortcodesInContent(raw, customShortcodes)
  if (normalized !== raw && !WHOLE_SHORTCODE.test(normalized.trim())) {
    return { mode: 'display', value: normalized.trim() }
  }

  if (whole) {
    return { mode: 'profile', shortcode: whole[1], placeholder: raw }
  }

  return { mode: 'display', value: raw }
}

/** Match a custom shortcode from a loaded author NIP-30 inventory. */
export function resolveAuthorEmojiForReactionShortcode(
  infos: readonly TEmoji[],
  shortcode: string
): TEmoji | undefined {
  return findEmojiByShortcode(infos, shortcode)
}
