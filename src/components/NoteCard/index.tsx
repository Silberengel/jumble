import { Skeleton } from '@/components/ui/skeleton'
import { isMentioningMutedUsers, isNip18RepostKind, isNip56ReportEvent } from '@/lib/event'
import ReportCard from '@/components/ReportCard'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useMuteList } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { Event } from 'nostr-tools'
import { memo, useMemo } from 'react'
import MainNoteCard from './MainNoteCard'
import RepostNoteCard from './RepostNoteCard'

const NoteCard = memo(function NoteCard({
  event,
  className,
  filterMutedNotes = true,
  pinned = false,
  hideParentNotePreview = false,
  bottomNoteLabel,
  fetchNoteStatsIfMissing = true,
  deferAuthorAvatar = true,
  searchListPreview = false,
  seenOnAllowlist
}: {
  event: Event
  className?: string
  filterMutedNotes?: boolean
  pinned?: boolean
  /** When true, hide the parent/root note preview (e.g. when showing quotes of the current note). */
  hideParentNotePreview?: boolean
  /** Optional label rendered at the bottom of the card (e.g. why this event is in a composed feed). */
  bottomNoteLabel?: string
  fetchNoteStatsIfMissing?: boolean
  deferAuthorAvatar?: boolean
  searchListPreview?: boolean
  seenOnAllowlist?: readonly string[]
}) {
  const { mutePubkeySet } = useMuteList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const shouldHide = useMemo(() => {
    if (filterMutedNotes && muteSetHas(mutePubkeySet, event.pubkey)) {
      return true
    }
    if (hideContentMentioningMutedUsers && isMentioningMutedUsers(event, mutePubkeySet)) {
      return true
    }
    return false
  }, [event, filterMutedNotes, mutePubkeySet])
  if (shouldHide) return null

  if (isNip56ReportEvent(event)) {
    return <ReportCard event={event} className={className} />
  }
  if (isNip18RepostKind(event.kind)) {
    return (
      <RepostNoteCard
        event={event}
        className={className}
        filterMutedNotes={filterMutedNotes}
        pinned={pinned}
        bottomNoteLabel={bottomNoteLabel}
        deferAuthorAvatar={deferAuthorAvatar}
        seenOnAllowlist={seenOnAllowlist}
      />
    )
  }
  return (
    <MainNoteCard
      event={event}
      className={className}
      pinned={pinned}
      hideParentNotePreview={hideParentNotePreview}
      bottomNoteLabel={bottomNoteLabel}
      fetchNoteStatsIfMissing={fetchNoteStatsIfMissing}
      deferAuthorAvatar={deferAuthorAvatar}
      searchListPreview={searchListPreview}
      seenOnAllowlist={seenOnAllowlist}
    />
  )
}, (prevProps, nextProps) => {
  // Custom comparison function for memo
  return (
    prevProps.event.id === nextProps.event.id &&
    prevProps.event.created_at === nextProps.event.created_at &&
    prevProps.className === nextProps.className &&
    prevProps.filterMutedNotes === nextProps.filterMutedNotes &&
    prevProps.pinned === nextProps.pinned &&
    prevProps.hideParentNotePreview === nextProps.hideParentNotePreview &&
    prevProps.bottomNoteLabel === nextProps.bottomNoteLabel &&
    prevProps.fetchNoteStatsIfMissing === nextProps.fetchNoteStatsIfMissing &&
    prevProps.seenOnAllowlist === nextProps.seenOnAllowlist &&
    prevProps.deferAuthorAvatar === nextProps.deferAuthorAvatar &&
    prevProps.searchListPreview === nextProps.searchListPreview
  )
})

export default NoteCard

export function NoteCardLoadingSkeleton() {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center space-x-2">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className={`flex-1 w-0`}>
          <div className="py-1">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="py-0.5">
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      </div>
      <div className="pt-2">
        <div className="my-1">
          <Skeleton className="w-full h-4 my-1 mt-2" />
        </div>
        <div className="my-1">
          <Skeleton className="w-2/3 h-4 my-1" />
        </div>
      </div>
    </div>
  )
}
