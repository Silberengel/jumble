import PostTextarea, { type TPostTextareaHandle } from '@/components/PostEditor/PostTextarea'
import { NeventPickerProvider } from '@/components/PostEditor/PostTextarea/Mention/NeventPickerProvider'
import {
  PostEditorFormatToolbar,
  type PostEditorFormatToolbarUploadHandlers
} from '@/components/PostEditor/PostEditorFormatToolbar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ExtendedKind } from '@/constants'
import { createShortNoteEditProposalDraftEvent } from '@/lib/draft-event'
import { getContentWarningLabel } from '@/lib/content-warning'
import { isNsfwEvent } from '@/lib/event'
import { imageUrlLooksLikeHttpImage } from '@/lib/composer-markup-insert'
import { canPublishWithContent } from '@/lib/publish-content-required'
import {
  showPublishingError,
  showPublishingFeedback,
  showSimplePublishSuccess
} from '@/lib/publishing-feedback'
import { baselineShortNoteContentForProposal } from '@/lib/short-note-edits'
import { useShortNoteEdits } from '@/hooks/useShortNoteEdits'
import { useNostr } from '@/providers/NostrProvider'
import shortNoteEditsService from '@/services/short-note-edits.service'
import storage from '@/services/local-storage.service'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function SuggestShortNoteEditDialog({
  open,
  onOpenChange,
  sourceEvent
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceEvent: Event
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const editState = useShortNoteEdits(sourceEvent)
  const baseline = useMemo(
    () => baselineShortNoteContentForProposal(sourceEvent, editState),
    [sourceEvent, editState?.latestAuthorEdit?.id, editState?.latestAuthorEdit?.content]
  )
  const [content, setContent] = useState(baseline)
  const [summary, setSummary] = useState('')
  const [publishing, setPublishing] = useState(false)
  const textareaRef = useRef<TPostTextareaHandle>(null)
  const prevOpenRef = useRef(false)

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setContent(baseline)
      setSummary('')
      const syncEditor = () => textareaRef.current?.setDocumentFromPlainText(baseline)
      requestAnimationFrame(syncEditor)
      window.setTimeout(syncEditor, 0)
      window.setTimeout(syncEditor, 50)
    }
    prevOpenRef.current = open
  }, [open, baseline])

  const toolbarUploadHandlers = useMemo<PostEditorFormatToolbarUploadHandlers>(
    () => ({
      onUploadSuccess: ({ url, file }) => {
        if (!url) return
        const treatAsImage = file
          ? file.type.startsWith('image/') || imageUrlLooksLikeHttpImage(url)
          : imageUrlLooksLikeHttpImage(url)
        textareaRef.current?.insertText(
          treatAsImage ? `\n${url}\n` : url
        )
      }
    }),
    []
  )

  const handlePublish = async () => {
    await checkLogin(async () => {
      if (!canPublishWithContent(ExtendedKind.SHORT_NOTE_EDIT, content)) return
      if (content.trim() === baseline.trim()) {
        showPublishingError(t('Change the note text before submitting a suggestion.'))
        return
      }
      setPublishing(true)
      try {
        const draft = await createShortNoteEditProposalDraftEvent(content, sourceEvent, {
          summary: summary.trim() || undefined,
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
            { message: t('Edit suggestion sent'), duration: 6000 }
          )
        } else {
          showSimplePublishSuccess(t('Edit suggestion sent'))
        }
        onOpenChange(false)
      } catch (e) {
        showPublishingError(e instanceof Error ? e : String(e))
      } finally {
        setPublishing(false)
      }
    })
  }

  if (sourceEvent.kind !== kinds.ShortTextNote) return null

  return (
    <NeventPickerProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-2 pr-14">
            <DialogTitle>{t('Suggest edit')}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t(
                'Propose a change to this note (NIP-41). The author can accept it by publishing their own edit with your text.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t('Proposed note text')}</label>
              <div className="space-y-2 rounded-lg border border-border/80 overflow-hidden">
                {open ? (
                <PostTextarea
                  ref={textareaRef}
                  text={content}
                  setText={setContent}
                  parentEvent={sourceEvent}
                  kind={kinds.ShortTextNote}
                  previewKind={ExtendedKind.SHORT_NOTE_EDIT}
                  extraPreviewTags={[['e', sourceEvent.id, '', sourceEvent.pubkey], ['p', sourceEvent.pubkey]]}
                  addClientTag={storage.getAddClientTag()}
                  className="min-h-[160px]"
                />
                ) : null}
                <div className="border-t border-border/60 px-2 py-1.5 overflow-x-auto">
                  <PostEditorFormatToolbar
                    insertText={(text) => textareaRef.current?.insertText(text)}
                    insertEmoji={(emoji) => textareaRef.current?.insertEmoji(emoji)}
                    upload={toolbarUploadHandlers}
                    showAudioUpload={false}
                    audioUploadTitle=""
                    audioButtonHighlighted={false}
                    showMoreOptions={false}
                    onToggleMoreOptions={() => {}}
                    showAdvancedSettings={false}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="edit-proposal-summary" className="text-sm font-medium">
                {t('Message to author')} ({t('optional')})
              </label>
              <Textarea
                id="edit-proposal-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={2}
                placeholder={t('Explain why you suggest this change')}
                className="resize-y min-h-[72px]"
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 px-6 py-4 border-t gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
              {t('Cancel')}
            </Button>
            <Button type="button" onClick={() => void handlePublish()} disabled={publishing}>
              {publishing ? t('Publishing…') : t('Send suggestion')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NeventPickerProvider>
  )
}
