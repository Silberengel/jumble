import Emoji from '@/components/Emoji'
import { ExtendedKind } from '@/constants'
import {
  EMPTY_AUTHOR_NIP30_EMOJIS,
  fetchAuthorNip30EmojiInfos,
  fetchAuthorNip30EmojiInfosFromIndexedDb,
  getAuthorNip30EmojiCache,
  subscribeAuthorNip30EmojiCache
} from '@/lib/nip30-author-emojis'
import { resolveAuthorEmojiForReactionShortcode, resolveReactionEmojiSync } from '@/lib/reaction-display'
import { cn } from '@/lib/utils'
import { TEmoji } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

/**
 * Renders a reaction glyph (Unicode, standard :shortcode:, or NIP-30 custom image from reactor profile).
 */
export default function ReactionEmojiDisplay({
  event,
  className,
  maxRawLength = 64,
  variant = 'default'
}: {
  event: Event
  className?: string
  /** Truncate long reaction text beyond this length */
  maxRawLength?: number
  /** `compact`: content previews; `thread`: reply-list reaction rows (large glyph). */
  variant?: 'default' | 'compact' | 'thread'
}) {
  const sync = useMemo(
    () => resolveReactionEmojiSync(event, maxRawLength),
    [event, maxRawLength]
  )

  const reactorPubkey = event.pubkey?.trim().toLowerCase() ?? ''
  const needsAuthorLookup = sync.mode === 'profile'

  const authorEmojis = useSyncExternalStore(
    (onStoreChange) =>
      needsAuthorLookup && /^[0-9a-f]{64}$/.test(reactorPubkey)
        ? subscribeAuthorNip30EmojiCache(reactorPubkey, onStoreChange)
        : () => {},
    () =>
      needsAuthorLookup && /^[0-9a-f]{64}$/.test(reactorPubkey)
        ? getAuthorNip30EmojiCache(reactorPubkey)
        : EMPTY_AUTHOR_NIP30_EMOJIS,
    () => EMPTY_AUTHOR_NIP30_EMOJIS
  )

  useEffect(() => {
    if (!needsAuthorLookup || !/^[0-9a-f]{64}$/.test(reactorPubkey)) return
    void fetchAuthorNip30EmojiInfosFromIndexedDb(reactorPubkey)
    void fetchAuthorNip30EmojiInfos(reactorPubkey)
  }, [needsAuthorLookup, reactorPubkey])

  const value: TEmoji | string = useMemo(() => {
    if (sync.mode === 'display') return sync.value
    const hit = resolveAuthorEmojiForReactionShortcode(authorEmojis, sync.shortcode)
    return hit ?? sync.placeholder
  }, [sync, authorEmojis])

  if (
    (event.kind !== kinds.Reaction && event.kind !== ExtendedKind.EXTERNAL_REACTION) ||
    (sync.mode === 'display' && sync.value === '')
  ) {
    return null
  }

  /** Unicode / shortcode strings must not get `img` max-height classes — {@link Emoji} merges both onto one span and clips glyphs. */
  const emojiClassNames =
    variant === 'thread'
      ? typeof value === 'object'
        ? {
            img: 'size-[calc(1.85rem*4/3)] max-h-[2.25rem] w-auto rounded-md opacity-95 inline-block align-middle'
          }
        : { text: 'text-2xl sm:text-3xl leading-normal tracking-tight' }
      : {
          img:
            variant === 'compact'
              ? 'size-[calc(1rem*4/3)] max-h-[1em] w-auto rounded-sm'
              : 'size-[calc(1.75rem*4/3)] max-h-[1.5em] w-auto rounded-sm',
          text: variant === 'compact' ? 'text-base leading-none' : 'text-2xl leading-none'
        }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center select-none',
        variant === 'thread' ? 'overflow-visible leading-normal py-0.5' : 'leading-none',
        className
      )}
      aria-hidden
    >
      <Emoji emoji={value} classNames={emojiClassNames} />
    </span>
  )
}
