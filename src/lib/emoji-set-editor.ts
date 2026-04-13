import { tagNameEquals } from '@/lib/tag'
import type { TEmoji } from '@/types'
import { kinds, type Event } from 'nostr-tools'

export function getEmojiSetDTag(event: Event): string | undefined {
  return event.tags.find(tagNameEquals('d'))?.[1]
}

export function labelEmojiSetEvent(event: Event): string {
  const title = event.tags.find(tagNameEquals('title'))?.[1]?.trim()
  if (title) return title
  const d = getEmojiSetDTag(event)
  return d ?? 'emoji set'
}

export function isEmojiSetPointerTag(tag: string[]): boolean {
  if (tag[0] !== 'a' || !tag[1]) return false
  const k = parseInt(tag[1].split(':')[0] ?? '', 10)
  return k === kinds.Emojisets
}

/** Tags on kind 10030 other than inline `emoji` entries and `a` → 30030 pointers. */
export function preservedTagsFromUserEmojiListEvent(event: Event | null): string[][] {
  if (!event) return []
  return event.tags.filter((t) => {
    if (t[0] === 'emoji') return false
    if (isEmojiSetPointerTag(t)) return false
    return true
  })
}

/** Normalize `30030:<hex64>:<d>` for an `a` tag value (pubkey lowercased). */
export function normalizeEmojiSetATagValue(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, '')
  const m = /^(\d+):([0-9a-f]{64}):([\s\S]*)$/i.exec(s)
  if (!m) return null
  const kind = parseInt(m[1], 10)
  if (kind !== kinds.Emojisets) return null
  const pk = m[2].toLowerCase()
  return `${kinds.Emojisets}:${pk}:${m[3]}`
}

export function buildEmojiSetTags(params: {
  d: string
  title?: string
  description?: string
  image?: string
  emojis: TEmoji[]
}): string[][] {
  const d = params.d.trim()
  if (!d) throw new Error('Invalid list id')
  const tags: string[][] = [['d', d]]
  const title = params.title?.trim()
  if (title) tags.push(['title', title])
  const description = params.description?.trim()
  if (description) tags.push(['description', description])
  const image = params.image?.trim()
  if (image) tags.push(['image', image])
  for (const e of params.emojis) {
    const sc = e.shortcode.trim().replace(/^:+|:+$/gu, '')
    const url = e.url.trim()
    if (!sc || !url) continue
    tags.push(['emoji', sc, url])
  }
  return tags
}

export function extractEmojiSetEditorFields(event: Event): {
  d: string
  title: string
  description: string
  image: string
  emojis: TEmoji[]
} {
  const emojis: TEmoji[] = []
  for (const t of event.tags) {
    if (t[0] === 'emoji' && t[1] && t[2]) {
      emojis.push({ shortcode: t[1], url: t[2] })
    }
  }
  return {
    d: getEmojiSetDTag(event) ?? '',
    title: event.tags.find(tagNameEquals('title'))?.[1] ?? '',
    description: event.tags.find(tagNameEquals('description'))?.[1] ?? '',
    image: event.tags.find(tagNameEquals('image'))?.[1] ?? '',
    emojis
  }
}

export function dedupeEmojiSetEventsByD(events: Event[]): Event[] {
  const byD = new Map<string, Event>()
  for (const e of [...events].sort((a, b) => b.created_at - a.created_at)) {
    const d = getEmojiSetDTag(e)
    if (!d) continue
    if (!byD.has(d)) byD.set(d, e)
  }
  return [...byD.values()].sort((a, b) =>
    labelEmojiSetEvent(a).localeCompare(labelEmojiSetEvent(b), undefined, { sensitivity: 'base' })
  )
}
