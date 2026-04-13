import { EMOJI_SHORT_CODE_REGEX } from '@/lib/content-patterns'
import {
  fetchAuthorNip30EmojiInfos,
  fetchAuthorNip30EmojiInfosFromIndexedDb
} from '@/lib/nip30-author-emojis'
import { getEmojiInfosFromEmojiTags } from '@/lib/tag'
import { TEmoji } from '@/types'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { type Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'

/** Event `emoji` tags override the same shortcode from the author's kind 0. */
export function mergeEmojiInfosEventOverridesAuthor(
  fromAuthor: TEmoji[],
  fromEvent: TEmoji[]
): TEmoji[] {
  const m = new Map<string, TEmoji>()
  for (const e of fromAuthor) m.set(e.shortcode, e)
  for (const e of fromEvent) m.set(e.shortcode, e)
  return [...m.values()]
}

/**
 * True when `content` contains a `:shortcode:` that is neither defined on the event nor a known
 * standard (Unicode) shortcode — likely a custom emoji from the author's profile.
 */
export function contentNeedsAuthorEmojiLookup(content: string | undefined, eventTagInfos: TEmoji[]): boolean {
  if (!content) return false
  const eventCodes = new Set(eventTagInfos.map((e) => e.shortcode))
  const re = new RegExp(EMOJI_SHORT_CODE_REGEX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const code = m[1].trim()
    if (eventCodes.has(code)) continue
    const native = shortcodeToEmoji(code, emojis) ?? shortcodeToEmoji(code.replace(/\s+/g, '_'), emojis)
    if (!native?.emoji) return true
  }
  return false
}

/**
 * NIP-30 emoji tags on the event plus, when needed, the author’s published custom emoji
 * (kind 0, 10030, and 30030 — same inventory approach as the emoji picker).
 */
export function useEmojiInfosForEvent(event: Event | undefined | null): TEmoji[] {
  const fromEvent = useMemo(() => getEmojiInfosFromEmojiTags(event?.tags ?? []), [event?.tags])
  const needsLookup = useMemo(
    () => (event ? contentNeedsAuthorEmojiLookup(event.content, fromEvent) : false),
    [event?.id, event?.content, fromEvent]
  )
  const pubkey = event?.pubkey?.trim().toLowerCase() ?? ''
  const validPk = /^[0-9a-f]{64}$/.test(pubkey)

  const [fromAuthor, setFromAuthor] = useState<TEmoji[]>([])

  useEffect(() => {
    if (!needsLookup || !validPk) {
      setFromAuthor([])
      return
    }
    let cancelled = false
    let fullResolved = false
    void fetchAuthorNip30EmojiInfosFromIndexedDb(pubkey).then((infos) => {
      if (cancelled || fullResolved) return
      setFromAuthor(infos)
    })
    void fetchAuthorNip30EmojiInfos(pubkey)
      .then((infos) => {
        if (cancelled) return
        fullResolved = true
        setFromAuthor(infos)
      })
      .catch(() => {
        fullResolved = true
      })
    return () => {
      cancelled = true
    }
  }, [needsLookup, validPk, pubkey])

  return useMemo(
    () => mergeEmojiInfosEventOverridesAuthor(fromAuthor, fromEvent),
    [fromAuthor, fromEvent]
  )
}
