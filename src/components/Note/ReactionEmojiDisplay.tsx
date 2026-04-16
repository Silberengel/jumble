import Emoji from '@/components/Emoji'
import { ExtendedKind } from '@/constants'
import { fetchAuthorNip30EmojiInfos } from '@/lib/nip30-author-emojis'
import { resolveReactionEmojiSync } from '@/lib/reaction-display'
import { cn } from '@/lib/utils'
import { TEmoji } from '@/types'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'

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
  /** Compact row (notification list); `thread` matches reply-list density */
  variant?: 'default' | 'compact' | 'thread'
}) {
  const sync = useMemo(
    () => resolveReactionEmojiSync(event, maxRawLength),
    [event, maxRawLength]
  )

  const initial: TEmoji | string =
    sync.mode === 'display' ? sync.value : sync.placeholder

  const [value, setValue] = useState<TEmoji | string>(initial)

  useEffect(() => {
    setValue(initial)
  }, [initial, event.id])

  useEffect(() => {
    if (sync.mode !== 'profile' || (event.kind !== kinds.Reaction && event.kind !== ExtendedKind.EXTERNAL_REACTION))
      return
    let cancelled = false
    void fetchAuthorNip30EmojiInfos(event.pubkey).then((infos) => {
      if (cancelled) return
      const hit = infos.find((i) => i.shortcode === sync.shortcode)
      if (hit) setValue(hit)
    })
    return () => {
      cancelled = true
    }
  }, [event.pubkey, event.kind, sync])

  if (
    (event.kind !== kinds.Reaction && event.kind !== ExtendedKind.EXTERNAL_REACTION) ||
    (sync.mode === 'display' && sync.value === '')
  ) {
    return null
  }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center leading-none select-none', className)}
      aria-hidden
    >
      <Emoji
        emoji={value}
        classNames={{
          img:
            variant === 'thread'
              ? 'size-[calc(0.875rem*4/3)] max-h-[1em] w-auto rounded-sm opacity-90'
              : variant === 'compact'
                ? 'size-[calc(1rem*4/3)] max-h-[1em] w-auto rounded-sm'
                : 'size-[calc(1.75rem*4/3)] max-h-[1.5em] w-auto rounded-sm',
          text:
            variant === 'thread'
              ? 'text-sm leading-none'
              : variant === 'compact'
                ? 'text-base leading-none'
                : 'text-2xl leading-none'
        }}
      />
    </span>
  )
}
