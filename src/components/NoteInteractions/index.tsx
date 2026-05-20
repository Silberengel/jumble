import { Separator } from '@/components/ui/separator'
import { ExtendedKind } from '@/constants'
import { shouldHideInteractions } from '@/lib/event-filtering'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import HideUntrustedContentButton from '../HideUntrustedContentButton'
import ReplyNoteList from '../ReplyNoteList'
import ReplySort, { ReplySortOption } from './ReplySort'

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
  const { t } = useTranslation()
  const [replySort, setReplySort] = useState<ReplySortOption>('oldest')
  const isDiscussion = event.kind === ExtendedKind.DISCUSSION
  const showQuotes = showQuotesProp ?? !isDiscussion

  // Hide interactions if event is in quiet mode
  if (shouldHideInteractions(event)) {
    return null
  }

  return (
    <>
      <div className="flex items-center gap-2 min-w-0 px-2 sm:px-4 md:px-6 py-2">
        <h2 className="min-w-0 flex-1 font-semibold text-xs sm:text-sm md:text-base text-foreground">
          {t('Replies')}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {isDiscussion && (
            <ReplySort selectedSort={replySort} onSortChange={setReplySort} />
          )}
          <HideUntrustedContentButton type="interactions" size="icon" />
        </div>
      </div>
      <Separator />
      <ReplyNoteList
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
