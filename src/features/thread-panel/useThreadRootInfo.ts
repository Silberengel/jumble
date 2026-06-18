import type { TRootInfo } from './types'
import { canonicalizeRssArticleUrl, getArticleUrlFromCommentITags } from '@/lib/rss-article'
import {
  getReplaceableCoordinateFromEvent,
  getRootATag,
  getRootETag,
  isReplaceableEvent,
  resolveDeclaredThreadRootEventHex
} from '@/lib/event'
import { generateBech32IdFromETag } from '@/lib/tag'
import { ExtendedKind } from '@/constants'
import client, { eventService } from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { useEffect, useState } from 'react'

/** Resolve E/A/I thread root metadata for the open note. */
export function useThreadRootInfo(event: Event) {
  const [rootInfo, setRootInfo] = useState<TRootInfo | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const fetchRootEvent = async () => {
      if (event.kind === ExtendedKind.RSS_THREAD_ROOT) {
        const url = getArticleUrlFromCommentITags(event)
        if (url && !cancelled) {
          setRootInfo({ type: 'I', id: canonicalizeRssArticleUrl(url) })
        }
        return
      }

      let root: TRootInfo

      if (isReplaceableEvent(event.kind)) {
        root = {
          type: 'A',
          id: getReplaceableCoordinateFromEvent(event),
          eventId: event.id,
          pubkey: event.pubkey,
          relay: client.getEventHint(event.id)
        }
      } else {
        const eid = event.id
        root = {
          type: 'E',
          id: /^[0-9a-f]{64}$/i.test(eid) ? eid.toLowerCase() : eid,
          pubkey: event.pubkey
        }
      }

      const rootETag = getRootETag(event)
      if (rootETag) {
        const [, rootEventHexId, , , rootEventPubkey] = rootETag
        if (rootEventHexId && rootEventPubkey) {
          const hid = resolveDeclaredThreadRootEventHex(rootEventHexId)
          const resolvedRootEvent = client.peekSessionCachedEvent(hid)
          root = {
            type: 'E',
            id: /^[0-9a-f]{64}$/i.test(hid) ? hid.toLowerCase() : hid,
            pubkey: resolvedRootEvent?.pubkey ?? rootEventPubkey
          }
        } else {
          const rootEventId = generateBech32IdFromETag(rootETag)
          if (rootEventId) {
            const rootEvent = await eventService.fetchEvent(rootEventId)
            if (cancelled) return
            if (rootEvent) {
              const rid = resolveDeclaredThreadRootEventHex(rootEvent.id)
              const resolvedRootEvent = client.peekSessionCachedEvent(rid) ?? rootEvent
              root = {
                type: 'E',
                id: /^[0-9a-f]{64}$/i.test(rid) ? rid.toLowerCase() : rid,
                pubkey: resolvedRootEvent.pubkey
              }
            }
          }
        }
      } else if (event.kind === ExtendedKind.COMMENT) {
        const rootATag = getRootATag(event)
        if (rootATag) {
          const [, coordinate, relay] = rootATag
          const [, pubkey] = coordinate.split(':')
          root = { type: 'A', id: coordinate, eventId: event.id, pubkey, relay }
        }
        const rootArticleUrl = getArticleUrlFromCommentITags(event)
        if (rootArticleUrl) {
          root = { type: 'I', id: canonicalizeRssArticleUrl(rootArticleUrl) }
        }
      }

      if (!cancelled) setRootInfo(root)
    }

    void fetchRootEvent()
    return () => {
      cancelled = true
    }
  }, [event])

  return rootInfo
}
