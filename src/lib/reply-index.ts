import {
  canonicalizeRssArticleUrl,
  getArticleUrlFromCommentITags,
  getHighlightSourceHttpUrl
} from '@/lib/rss-article'
import {
  getParentATag,
  getParentETag,
  getQuotedReferenceFromQTags,
  getRootATag,
  getRootETag,
  isNip18RepostKind,
  isNip25ReactionKind,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { getFirstHexEventIdFromETags } from '@/lib/tag'
import { NOTE_STATS_OP_REFERENCE_KINDS } from '@/constants'
import { isNostrTargetWebBookmark } from '@/lib/web-bookmark-nip'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

export type TRepliesMap = Map<string, { events: Event[]; eventIdSet: Set<string> }>

/** Index bookmark/list/op-reference rows under each `e` / `a` / `q` target they tag. */
function indexOpReferenceReplyTargets(reply: Event, newReplyEventMap: Map<string, Event[]>) {
  const isOpRef =
    NOTE_STATS_OP_REFERENCE_KINDS.includes(reply.kind) || isNostrTargetWebBookmark(reply)
  if (!isOpRef) return

  for (const t of reply.tags) {
    const name = t[0]
    const v = typeof t[1] === 'string' ? t[1].trim() : ''
    if (!v) continue
    if (name === 'e' || name === 'E') {
      if (/^[0-9a-f]{64}$/i.test(v)) {
        const key = v.toLowerCase()
        newReplyEventMap.set(key, [...(newReplyEventMap.get(key) || []), reply])
      }
    } else if (name === 'a' || name === 'A' || name === 'q' || name === 'Q') {
      newReplyEventMap.set(v, [...(newReplyEventMap.get(v) || []), reply])
    }
  }
}

/** Index reply events under root / parent / quote keys (shared by global and per-thread maps). */
export function mergeRepliesIntoMap(prev: TRepliesMap, replies: Event[]): TRepliesMap {
  const newReplyIdSet = new Set<string>()
  const newReplyEventMap = new Map<string, Event[]>()

  for (const reply of replies) {
    if (newReplyIdSet.has(reply.id)) continue
    if (isNip18RepostKind(reply.kind)) {
      client.addEventToCache(reply)
      continue
    }
    if (isNip25ReactionKind(reply.kind)) {
      newReplyIdSet.add(reply.id)
      client.addEventToCache(reply)
      const targetHex = getFirstHexEventIdFromETags(reply.tags)
      if (targetHex && /^[0-9a-f]{64}$/i.test(targetHex)) {
        const key = targetHex.toLowerCase()
        newReplyEventMap.set(key, [...(newReplyEventMap.get(key) || []), reply])
      }
      continue
    }
    newReplyIdSet.add(reply.id)
    client.addEventToCache(reply)

    let rootId: string | undefined
    const rootETag = getRootETag(reply)
    if (rootETag) {
      const raw = rootETag[1]?.toLowerCase?.() ?? rootETag[1]
      rootId =
        raw && /^[0-9a-f]{64}$/i.test(raw) ? resolveDeclaredThreadRootEventHex(raw) : raw
    } else {
      const rootATag = getRootATag(reply)
      if (rootATag) {
        rootId = rootATag[1]
      } else {
        const articleUrl = getArticleUrlFromCommentITags(reply)
        if (articleUrl) {
          rootId = canonicalizeRssArticleUrl(articleUrl)
        } else if (reply.kind === kinds.Highlights) {
          const hu = getHighlightSourceHttpUrl(reply)
          if (hu) rootId = canonicalizeRssArticleUrl(hu)
        }
      }
    }
    if (rootId) {
      newReplyEventMap.set(rootId, [...(newReplyEventMap.get(rootId) || []), reply])
    }

    let parentId: string | undefined
    const parentETag = getParentETag(reply)
    if (parentETag) {
      parentId = parentETag[1]?.toLowerCase?.() ?? parentETag[1]
    } else {
      const parentATag = getParentATag(reply)
      if (parentATag) {
        parentId = parentATag[1]
      }
    }
    if (parentId && parentId !== rootId) {
      newReplyEventMap.set(parentId, [...(newReplyEventMap.get(parentId) || []), reply])
    }

    if (!rootId && !parentId) {
      const qref = getQuotedReferenceFromQTags(reply)
      const keys = new Set([qref?.hexId, qref?.coordinate].filter(Boolean) as string[])
      for (const key of keys) {
        newReplyEventMap.set(key, [...(newReplyEventMap.get(key) || []), reply])
      }
    }

    indexOpReferenceReplyTargets(reply, newReplyEventMap)
  }

  if (newReplyEventMap.size === 0) return prev

  const next = new Map(prev)
  for (const [id, newReplyEvents] of newReplyEventMap.entries()) {
    const existing = next.get(id)
    const events = existing ? [...existing.events] : []
    const eventIdSet = existing ? new Set(existing.eventIdSet) : new Set<string>()
    for (const reply of newReplyEvents) {
      const existingIdx = events.findIndex((e) => e.id === reply.id)
      if (existingIdx >= 0) {
        events[existingIdx] = reply
      } else {
        events.push(reply)
      }
      eventIdSet.add(reply.id)
    }
    next.set(id, { events, eventIdSet })
  }
  return next
}
