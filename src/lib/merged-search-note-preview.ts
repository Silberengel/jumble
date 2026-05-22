import { ExtendedKind } from '@/constants'
import { cardEventBodyBlurb } from '@/lib/card-event-body-blurb'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

const DOC_KINDS = new Set<number>([
  kinds.LongFormArticle,
  ExtendedKind.WIKI_ARTICLE,
  ExtendedKind.NOSTR_SPECIFICATION,
  ExtendedKind.PUBLICATION,
  ExtendedKind.PUBLICATION_CONTENT
])

/**
 * True if {@link NoteCard} should show a non-empty body in merged NIP-50 search rows.
 * Drops indexer stubs / empty shells that only show the “seen on” strip.
 */
export function mergedSearchNoteHasPreviewBody(ev: Event): boolean {
  const k = ev.kind
  if (k === kinds.ShortTextNote || k === ExtendedKind.COMMENT) {
    if (ev.tags.some((t) => t[0] === 'subject' && String(t[1] ?? '').trim().length > 0)) return true
    return Boolean(ev.content?.trim().length)
  }
  if (k === kinds.Metadata) {
    const c = ev.content?.trim() ?? ''
    if (c.length < 2) return false
    try {
      const j = JSON.parse(c) as {
        name?: unknown
        display_name?: unknown
        about?: unknown
        nip05?: unknown
      }
      const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
      return Boolean(pick(j.name) || pick(j.display_name) || pick(j.about) || pick(j.nip05))
    } catch {
      return c.length >= 2
    }
  }
  if (DOC_KINDS.has(k)) {
    const m = getLongFormArticleMetadataFromEvent(ev)
    if (m.title?.trim() || m.summary?.trim() || m.image?.trim() || m.tags.length > 0) return true
    return Boolean(cardEventBodyBlurb(ev.content).trim())
  }
  return true
}
