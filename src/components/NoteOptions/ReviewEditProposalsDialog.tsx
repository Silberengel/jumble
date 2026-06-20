import Username from '@/components/Username'
import ShortNoteEditDiffContent from '@/components/Note/ShortNoteEditDiffContent'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import { createShortNoteEditDraftEvent } from '@/lib/draft-event'
import { getContentWarningLabel } from '@/lib/content-warning'
import { isNsfwEvent } from '@/lib/event'
import {
  showPublishingError,
  showPublishingFeedback,
  showSimplePublishSuccess
} from '@/lib/publishing-feedback'
import { hexPubkeysEqual } from '@/lib/pubkey'
import {
  baselineShortNoteContentForProposal,
  getEditProposalSummary
} from '@/lib/short-note-edits'
import { useShortNoteEdits } from '@/hooks/useShortNoteEdits'
import { useNostr } from '@/providers/NostrProvider'
import shortNoteEditsService from '@/services/short-note-edits.service'
import storage from '@/services/local-storage.service'
import { Event, kinds } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function ReviewEditProposalsDialog({
  open,
  onOpenChange,
  sourceEvent
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceEvent: Event
}) {
  const { t } = useTranslation()
  const { publish, checkLogin, pubkey } = useNostr()
  const editState = useShortNoteEdits(sourceEvent)
  const proposals = editState?.editProposals ?? []
  const baseline = baselineShortNoteContentForProposal(sourceEvent, editState)
  const isAuthor = Boolean(pubkey && hexPubkeysEqual(pubkey, sourceEvent.pubkey))
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  const handleAccept = async (proposal: Event) => {
    await checkLogin(async () => {
      setAcceptingId(proposal.id)
      try {
        const draft = await createShortNoteEditDraftEvent(proposal.content, sourceEvent, {
          addClientTag: storage.getAddClientTag(),
          isNsfw: isNsfwEvent(sourceEvent),
          contentWarningLabel: getContentWarningLabel(sourceEvent) ?? undefined
        })
        const newEvent = (await publish(draft, {
          addClientTag: storage.getAddClientTag()
        })) as Event
        shortNoteEditsService.ingestEdit(sourceEvent, newEvent)
        if ((newEvent as any)?.relayStatuses) {
          const rs = (newEvent as any).relayStatuses
          showPublishingFeedback(
            {
              success: true,
              relayStatuses: rs,
              successCount: rs.filter((s: any) => s.success).length,
              totalCount: rs.length
            },
            { message: t('Edit published'), duration: 6000 }
          )
        } else {
          showSimplePublishSuccess(t('Edit published'))
        }
        onOpenChange(false)
      } catch (e) {
        showPublishingError(e instanceof Error ? e : String(e))
      } finally {
        setAcceptingId(null)
      }
    })
  }

  if (sourceEvent.kind !== kinds.ShortTextNote) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2 pr-14">
          <DialogTitle>
            {isAuthor ? t('Edit suggestions') : t('View suggested edits')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isAuthor
              ? t(
                  'Collaborative edit proposals (NIP-41). Accepting publishes your signed edit with the proposer’s text.'
                )
              : t('Collaborative edit proposals (NIP-41) from other users.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-3">
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('No edit suggestions yet.')}</p>
          ) : (
            proposals.map((proposal) => {
              const summary = getEditProposalSummary(proposal)
              const busy = acceptingId === proposal.id
              return (
                <Card key={proposal.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Username userId={proposal.pubkey} className="font-medium" />
                    <FormattedTimestamp timestamp={proposal.created_at} className="text-muted-foreground" />
                  </div>
                  {summary ? (
                    <p className="text-sm text-muted-foreground border-l-2 border-muted pl-3 italic">
                      {summary}
                    </p>
                  ) : null}
                  <ShortNoteEditDiffContent original={baseline} revised={proposal.content} />
                  {isAuthor ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!!acceptingId}
                        onClick={() => void handleAccept(proposal)}
                      >
                        {busy ? t('Publishing…') : t('Accept suggestion')}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              )
            })
          )}
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
