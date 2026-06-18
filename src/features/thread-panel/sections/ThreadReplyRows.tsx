import { getParentETag } from '@/lib/event'
import { generateBech32IdFromETag } from '@/lib/tag'
import ReplyNote from '@/components/ReplyNote'
import MissingThreadReply from '../components/MissingThreadReply'
import ThreadQuoteBacklink, { BacklinkAvatarStrip } from '../components/ThreadQuoteBacklink'
import { backlinkRunSectionClass, threadBacklinkRelationLabel } from '../thread-panel-utils'
import type { TBacklinkDisplayRow } from '../types'
import type { Event as NEvent } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import type { MutableRefObject } from 'react'

type ThreadReplyRowsProps = {
  displayRows: TBacklinkDisplayRow[]
  event: NEvent
  replyDuplicateWebPreviewHints?: string[]
  statsForeground: boolean
  onFoundMissing: (ev: NEvent) => void
  onClickParent: (reply: NEvent, parentEventHexId: string | undefined, parentEventId: string | undefined) => void
  onClickReply: (reply: NEvent) => void
  replyRefs: MutableRefObject<Record<string, HTMLDivElement | null>>
}

export default function ThreadReplyRows({
  displayRows,
  event,
  replyDuplicateWebPreviewHints,
  statsForeground,
  onFoundMissing,
  onClickParent,
  onClickReply,
  replyRefs
}: ThreadReplyRowsProps) {
  const { t } = useTranslation()

  return (
    <>
      {displayRows.map((row, ri) => {
        const prevRow = ri > 0 ? displayRows[ri - 1] : undefined
        if (row.type === 'missing-reply') {
          return (
            <div key={`missing-reply-${row.id}`} className="scroll-mt-12">
              <MissingThreadReply
                id={row.id}
                pubkey={row.pubkey}
                createdAt={row.created_at}
                onFound={onFoundMissing}
              />
            </div>
          )
        }
        if (row.type === 'reply') {
          const reply = row.event
          const parentETag = getParentETag(reply)
          const parentEventHexId = parentETag?.[1]
          const parentEventId = parentETag ? generateBech32IdFromETag(parentETag) : undefined

          return (
            <div
              ref={(el) => (replyRefs.current[reply.id] = el)}
              key={reply.id}
              className="scroll-mt-12"
            >
              <ReplyNote
                event={reply}
                parentEventId={event.id !== parentEventHexId ? parentEventId : undefined}
                duplicateWebPreviewCleanedUrlHints={replyDuplicateWebPreviewHints}
                foregroundStats={statsForeground}
                onClickParent={() => onClickParent(reply, parentEventHexId, parentEventId)}
                onClickReply={() => onClickReply(reply)}
              />
            </div>
          )
        }

        const { subsection, events: blEvents } = row
        const wrapClass = backlinkRunSectionClass(subsection, prevRow)

        if (subsection === 'bookmark') {
          return (
            <div key={`bl-bookmark-${blEvents[0].id}`} className={wrapClass}>
              <BacklinkAvatarStrip
                events={blEvents}
                sectionLabel={t('Thread backlinks bookmarks section')}
                relationLabelForTitle={t('bookmarked this note')}
              />
            </div>
          )
        }

        if (subsection === 'list') {
          return (
            <div key={`bl-list-${blEvents[0].id}`} className={wrapClass}>
              <BacklinkAvatarStrip
                events={blEvents}
                sectionLabel={t('Thread backlinks lists section')}
                getTitle={(e) => threadBacklinkRelationLabel(e, t)}
              />
            </div>
          )
        }

        if (subsection === 'report') {
          return (
            <div key={`bl-report-${blEvents[0].id}`} className={wrapClass}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-950/90 dark:text-amber-100/90">
                {t('Report events heading')}
              </h2>
              {blEvents.map((item) => (
                <div
                  key={item.id}
                  ref={(el) => (replyRefs.current[item.id] = el)}
                  className="scroll-mt-12 mb-1"
                >
                  <ThreadQuoteBacklink
                    event={item}
                    quoteKindLabel={threadBacklinkRelationLabel(item, t)}
                    variant="warning"
                  />
                </div>
              ))}
            </div>
          )
        }

        return (
          <div key={`bl-primary-${blEvents[0].id}`} className={wrapClass}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('Thread backlinks primary section')}
            </h2>
            {blEvents.map((item) => (
              <div
                key={item.id}
                ref={(el) => (replyRefs.current[item.id] = el)}
                className="scroll-mt-12 mb-1"
              >
                <ThreadQuoteBacklink
                  event={item}
                  quoteKindLabel={threadBacklinkRelationLabel(item, t)}
                  variant="default"
                />
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}

export function ThreadPanelFooter({
  loading,
  hasRows
}: {
  loading: boolean
  hasRows: boolean
}) {
  const { t } = useTranslation()
  if (loading) return null
  return (
    <div className="text-sm mt-2 mb-3 text-center text-muted-foreground">
      {hasRows ? t('no more replies') : t('no replies')}
    </div>
  )
}
