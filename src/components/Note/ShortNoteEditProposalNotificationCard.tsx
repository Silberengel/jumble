import ShortNoteEditDiffContent from '@/components/Note/ShortNoteEditDiffContent'
import { ExtendedKind } from '@/constants'
import { useFetchEvent } from '@/hooks/useFetchEvent'
import { useShortNoteEdits } from '@/hooks/useShortNoteEdits'
import {
  baselineShortNoteContentForProposal,
  getEditProposalSummary,
  getShortNoteEditTargetId,
  isCollaborativeEditProposal
} from '@/lib/short-note-edits'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import { useTranslation } from 'react-i18next'

export default function ShortNoteEditProposalNotificationCard({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const targetId = getShortNoteEditTargetId(event)
  const { event: targetNote } = useFetchEvent(targetId)
  const targetEditState = useShortNoteEdits(
    targetNote?.kind === kinds.ShortTextNote ? targetNote : undefined
  )
  const baseline = targetNote
    ? baselineShortNoteContentForProposal(targetNote, targetEditState)
    : ''
  const summary = getEditProposalSummary(event)

  if (event.kind !== ExtendedKind.SHORT_NOTE_EDIT || !targetId) return null
  const authorPubkey = targetNote?.pubkey ?? event.tags.find((t) => t[0] === 'p')?.[1]
  if (
    !authorPubkey ||
    !isCollaborativeEditProposal(event, { id: targetId, pubkey: authorPubkey })
  ) {
    return null
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card px-4 py-3 text-card-foreground shadow-sm space-y-2',
        className
      )}
    >
      <p className="text-sm font-medium">{t('Suggested an edit to your note')}</p>
      {summary ? (
        <p className="text-sm text-muted-foreground border-l-2 border-muted pl-3 italic">{summary}</p>
      ) : null}
      {baseline ? (
        <ShortNoteEditDiffContent original={baseline} revised={event.content} className="text-sm" />
      ) : (
        <p className="text-sm whitespace-pre-wrap break-words">{event.content}</p>
      )}
    </div>
  )
}
