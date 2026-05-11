import NoteCard from '@/components/NoteCard'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useDeletedEvent } from '@/providers/DeletedEventProvider'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { generateBech32IdFromATag, getFirstHexEventIdFromETags } from '@/lib/tag'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { hexPubkeysEqual, normalizeHexPubkey } from '@/lib/pubkey'
import { RefreshCw } from 'lucide-react'
import { kinds, type Event } from 'nostr-tools'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { useProfileTimeline } from '@/hooks/useProfileTimeline'

const INITIAL_SHOW_COUNT = 25
const LOAD_MORE_COUNT = 25
const LIKED_REACTION_KINDS = [kinds.Reaction, ExtendedKind.EXTERNAL_REACTION]

type ReactionTargetRef = {
  key: string
  fetchId: string
  hexId?: string
  relayHints: string[]
}

type LikedTarget = {
  reaction: Event
  target: Event
}

function isPositiveReaction(event: Event): boolean {
  return event.content.trim() !== '-'
}

function relayHintsForReactionTarget(event: Event, tag?: string[]): string[] {
  const hints = new Set(relayHintsFromEventTags(event))
  const tagHint = tag?.[2]?.trim()
  if (tagHint) hints.add(tagHint)
  return [...hints]
}

function reactionTargetRef(event: Event): ReactionTargetRef | null {
  const hexId = getFirstHexEventIdFromETags(event.tags)
  if (hexId) {
    return {
      key: `e:${hexId.toLowerCase()}`,
      fetchId: hexId,
      hexId,
      relayHints: relayHintsForReactionTarget(event)
    }
  }

  const addressTag = event.tags.find((tag) => (tag[0] === 'a' || tag[0] === 'A') && tag[1])
  if (!addressTag) return null
  const bech32Id = generateBech32IdFromATag(addressTag)
  if (!bech32Id) return null
  return {
    key: `a:${addressTag[1]}`,
    fetchId: bech32Id,
    relayHints: relayHintsForReactionTarget(event, addressTag)
  }
}

function samePubkey(a: string, b: string): boolean {
  try {
    return hexPubkeysEqual(normalizeHexPubkey(a), normalizeHexPubkey(b))
  } catch {
    return a === b
  }
}

function newestReactionTargets(reactions: Event[]): Array<{ reaction: Event; targetRef: ReactionTargetRef }> {
  const byTarget = new Map<string, { reaction: Event; targetRef: ReactionTargetRef }>()
  for (const reaction of reactions) {
    if (!isPositiveReaction(reaction)) continue
    const targetRef = reactionTargetRef(reaction)
    if (!targetRef) continue
    const existing = byTarget.get(targetRef.key)
    if (
      !existing ||
      reaction.created_at > existing.reaction.created_at ||
      (reaction.created_at === existing.reaction.created_at && reaction.id > existing.reaction.id)
    ) {
      byTarget.set(targetRef.key, { reaction, targetRef })
    }
  }
  return [...byTarget.values()].sort((a, b) => b.reaction.created_at - a.reaction.created_at)
}

const ProfileLikedFeed = forwardRef<{ refresh: () => void }, { pubkey: string }>(({ pubkey }, ref) => {
  const { t } = useTranslation()
  const { isEventDeleted } = useDeletedEvent()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isResolvingTargets, setIsResolvingTargets] = useState(false)
  const [likedTargets, setLikedTargets] = useState<LikedTarget[]>([])
  const [showCount, setShowCount] = useState(INITIAL_SHOW_COUNT)
  const bottomRef = useRef<HTMLDivElement>(null)

  const reactionKinds = useMemo(() => [...LIKED_REACTION_KINDS], [])
  const cacheKey = useMemo(() => `${pubkey}-profile-liked-v1`, [pubkey])
  const { events: reactionEvents, isLoading, refresh } = useProfileTimeline({
    pubkey,
    cacheKey,
    kinds: reactionKinds,
    limit: 200
  })

  const targetRefs = useMemo(() => newestReactionTargets(reactionEvents), [reactionEvents])

  useEffect(() => {
    setShowCount(INITIAL_SHOW_COUNT)
  }, [pubkey])

  useEffect(() => {
    if (!isLoading && !isResolvingTargets) {
      setIsRefreshing(false)
    }
  }, [isLoading, isResolvingTargets])

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        setIsRefreshing(true)
        refresh()
      }
    }),
    [refresh]
  )

  useEffect(() => {
    let cancelled = false
    const viewerPubkey = pubkey
    const toLikedTarget = (row: { reaction: Event; target: Event }): LikedTarget | null => {
      if (samePubkey(row.target.pubkey, viewerPubkey)) return null
      if (isEventDeleted(row.target)) return null
      return row
    }

    const cachedRows = targetRefs
      .map(({ reaction, targetRef }) => {
        const cached = targetRef.hexId ? client.peekSessionCachedEvent(targetRef.hexId) : undefined
        return cached ? toLikedTarget({ reaction, target: cached }) : null
      })
      .filter((row): row is LikedTarget => !!row)

    setLikedTargets(cachedRows)
    if (targetRefs.length === 0) {
      setIsResolvingTargets(false)
      return () => {
        cancelled = true
      }
    }

    setIsResolvingTargets(true)
    void (async () => {
      try {
        const hexIds = targetRefs.map(({ targetRef }) => targetRef.hexId).filter((id): id is string => !!id)
        if (hexIds.length > 0) {
          const [archived, publications] = await Promise.all([
            indexedDb.getArchivedEventsByIds(hexIds),
            Promise.all(hexIds.map((id) => indexedDb.getEventFromPublicationStore(id)))
          ])
          if (cancelled) return
          const localById = new Map<string, Event>()
          for (const event of archived) localById.set(event.id, event)
          for (const event of publications) {
            if (event) localById.set(event.id, event)
          }
          const localResolved = targetRefs
            .map(({ reaction, targetRef }) => {
              const target = targetRef.hexId ? localById.get(targetRef.hexId) : undefined
              return target ? toLikedTarget({ reaction, target }) : null
            })
            .filter((row): row is LikedTarget => !!row)
          if (localResolved.length > 0) {
            setLikedTargets((prev) => {
              const byTargetId = new Map(prev.map((row) => [row.target.id, row]))
              for (const row of localResolved) byTargetId.set(row.target.id, row)
              return [...byTargetId.values()].sort((a, b) => b.reaction.created_at - a.reaction.created_at)
            })
          }
        }

        const missingHexIds = targetRefs
          .map(({ targetRef }) => targetRef.hexId)
          .filter((id): id is string => !!id && !client.peekSessionCachedEvent(id))
        if (missingHexIds.length > 0) {
          await client.prefetchHexEventIds(missingHexIds)
        }

        const resolved = await Promise.all(
          targetRefs.map(async ({ reaction, targetRef }) => {
            const target =
              (targetRef.hexId ? client.peekSessionCachedEvent(targetRef.hexId) : undefined) ??
              await client.fetchEvent(targetRef.fetchId, { relayHints: targetRef.relayHints })
            if (!target) return null
            return toLikedTarget({ reaction, target })
          })
        )
        if (cancelled) return
        const byTargetId = new Map<string, LikedTarget>()
        for (const row of resolved) {
          if (!row) continue
          const existing = byTargetId.get(row.target.id)
          if (
            !existing ||
            row.reaction.created_at > existing.reaction.created_at ||
            (row.reaction.created_at === existing.reaction.created_at && row.reaction.id > existing.reaction.id)
          ) {
            byTargetId.set(row.target.id, row)
          }
        }
        setLikedTargets([...byTargetId.values()].sort((a, b) => b.reaction.created_at - a.reaction.created_at))
      } finally {
        if (!cancelled) setIsResolvingTargets(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [targetRefs, pubkey, isEventDeleted])

  const displayedTargets = useMemo(
    () => likedTargets.slice(0, showCount),
    [likedTargets, showCount]
  )

  useEffect(() => {
    if (!bottomRef.current || displayedTargets.length >= likedTargets.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayedTargets.length < likedTargets.length) {
          setShowCount((prev) => Math.min(prev + LOAD_MORE_COUNT, likedTargets.length))
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(bottomRef.current)
    return () => observer.disconnect()
  }, [displayedTargets.length, likedTargets.length])

  if ((isLoading || isResolvingTargets) && likedTargets.length === 0) {
    return (
      <div className="mt-4 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  if (likedTargets.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t('No liked posts yet')}
      </div>
    )
  }

  return (
    <div className="mt-4 min-w-0">
      {isRefreshing && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-center text-sm text-green-500"
          role="status"
          aria-live="polite"
        >
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t('Refreshing liked posts...')}
        </div>
      )}
      <div className="space-y-2">
        {displayedTargets.map(({ target }) => (
          <NoteCard key={target.id} className="w-full" event={target} filterMutedNotes={false} bottomNoteLabel={t('Liked by you')} />
        ))}
      </div>
      {displayedTargets.length < likedTargets.length && (
        <div ref={bottomRef} className="h-10 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">{t('Loading more...')}</div>
        </div>
      )}
    </div>
  )
})

ProfileLikedFeed.displayName = 'ProfileLikedFeed'

export default ProfileLikedFeed
