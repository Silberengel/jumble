import { ExtendedKind } from '@/constants'
import {
  getReplaceableCoordinateFromEvent,
  isReplaceableEvent,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { isRssArticleUrlThreadInteraction } from '@/lib/rss-web-feed'
import { canonicalizeRssArticleUrl, getArticleUrlFromCommentITags } from '@/lib/rss-article'
import type { TThreadRootRef } from '@/lib/thread-reply-root-match'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

const REF_TAG_NAMES = new Set(['e', 'E', 'a', 'A', 'q', 'Q'])

/**
 * True if any `e` / `E` / `a` / `A` / `q` / `Q` tag on `evt` references the thread root described by `root`
 * (hex id, replaceable coordinate, or canonical article URL). Used for broad “references OP” discovery
 * where {@link getRootEventHexId} does not apply (e.g. long-form on the OP).
 */
export function eventReferencesThreadTarget(evt: Event, root: TThreadRootRef): boolean {
  if (root.type === 'I') {
    return isRssArticleUrlThreadInteraction(evt, root.id)
  }
  if (root.type === 'A') {
    const coordNorm = normalizeReplaceableCoordinateString(root.id)
    const eventHex = root.eventId.trim().toLowerCase()
    for (const t of evt.tags) {
      const name = t[0]
      if (!REF_TAG_NAMES.has(name)) continue
      const v = typeof t[1] === 'string' ? t[1].trim() : ''
      if (!v) continue
      if (/^[0-9a-f]{64}$/i.test(v) && v.toLowerCase() === eventHex) return true
      if (name === 'a' || name === 'A') {
        if (normalizeReplaceableCoordinateString(v) === coordNorm) return true
      }
    }
    if (evt.kind === kinds.Zap) {
      const zapped = getZapInfoFromEvent(evt)?.originalEventId
      if (zapped && /^[0-9a-f]{64}$/i.test(zapped) && zapped.toLowerCase() === eventHex) return true
      const coord = getZapInfoFromEvent(evt)?.eventId
      if (coord && normalizeReplaceableCoordinateString(coord) === coordNorm) return true
    }
    return false
  }
  const hex = root.id.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false
  for (const t of evt.tags) {
    const name = t[0]
    if (!REF_TAG_NAMES.has(name)) continue
    const v = typeof t[1] === 'string' ? t[1].trim() : ''
    if (!v) continue
    if (/^[0-9a-f]{64}$/i.test(v) && v.toLowerCase() === hex) return true
  }
  if (evt.kind === kinds.Zap) {
    const zapped = getZapInfoFromEvent(evt)?.originalEventId
    if (zapped && /^[0-9a-f]{64}$/i.test(zapped) && zapped.toLowerCase() === hex) return true
  }
  return false
}

/** Build thread root ref from the note/article stats root (same shapes as {@link ReplyNoteList} `rootInfo`). */
export function threadRootRefFromStatsRootEvent(event: Event): TThreadRootRef | undefined {
  if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
    const url = getArticleUrlFromCommentITags(event)
    if (!url) return undefined
    return { type: 'I', id: canonicalizeRssArticleUrl(url) }
  }
  if (isReplaceableEvent(event.kind)) {
    return {
      type: 'A',
      id: getReplaceableCoordinateFromEvent(event),
      eventId: event.id,
      pubkey: event.pubkey
    }
  }
  return { type: 'E', id: event.id.trim().toLowerCase(), pubkey: event.pubkey }
}
