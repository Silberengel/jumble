import { ExtendedKind } from '@/constants'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import ThreadPanel from '@/features/thread-panel/ThreadPanel'
import ThreadPanelHeader, {
  threadPanelShowQuotes
} from '@/features/thread-panel/sections/ThreadPanelHeader'
import type { ReplySortOption } from './ReplySort'

export default function NoteInteractions({
  pageIndex,
  event,
  showQuotes: showQuotesProp,
  statsForeground = false,
  refreshToken = 0,
  singleRelayAuthoritativeRead = false
}: {
  pageIndex?: number
  event: Event
  /** When set, overrides the default (quotes hidden for discussions only). */
  showQuotes?: boolean
  /** Reply row stats use the same priority lane as the open note (`foregroundStats` on `NoteStats`). */
  statsForeground?: boolean
  /** Bump to force the reply list to refetch. */
  refreshToken?: number
  /** Explore single-relay context: scope reply REQ to the browsing relay only. */
  singleRelayAuthoritativeRead?: boolean
}) {
  const [replySort, setReplySort] = useState<ReplySortOption>('oldest')
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const showQuotes = threadPanelShowQuotes(event.kind, showQuotesProp)

  return (
    <>
      <ThreadPanelHeader
        replySort={replySort}
        onSortChange={setReplySort}
        isDiscussion={isDiscussion}
      />
      <ThreadPanel
        index={pageIndex}
        event={event}
        sort={replySort}
        showQuotes={showQuotes}
        statsForeground={statsForeground}
        refreshToken={refreshToken}
        singleRelayAuthoritativeRead={singleRelayAuthoritativeRead}
      />
    </>
  )
}
