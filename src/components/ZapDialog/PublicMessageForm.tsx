import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ExtendedKind } from '@/constants'
import { createPublicMessageDraftEvent } from '@/lib/draft-event'
import { createFakeEvent } from '@/lib/event'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { pubkeyToNpub } from '@/lib/pubkey'
import { showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'

const TIP_NOTICE_DEFAULT_KEY = 'I just sent you a tip!'

function defaultTipNoticeMessage(recipientPubkey: string, tipText: string): string {
  const npub = pubkeyToNpub(recipientPubkey)
  return `nostr:${npub} ${tipText}`
}

export default function PublicMessageForm({
  recipientPubkey,
  onBack,
  onDone
}: {
  recipientPubkey: string
  onBack: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const { publish, checkLogin, pubkey: selfPubkey } = useNostr()
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const tipText = t(TIP_NOTICE_DEFAULT_KEY)

  useEffect(() => {
    setMessage(defaultTipNoticeMessage(recipientPubkey, tipText))
  }, [recipientPubkey, tipText])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      )
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const previewEvent = useMemo(() => {
    return createFakeEvent({
      kind: ExtendedKind.PUBLIC_MESSAGE,
      pubkey: selfPubkey ?? '',
      content: message,
      tags: [['p', recipientPubkey]]
    })
  }, [message, recipientPubkey, selfPubkey])

  const handleSend = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    checkLogin(async () => {
      if (selfPubkey === recipientPubkey) {
        onDone()
        return
      }
      setSending(true)
      try {
        const draft = await createPublicMessageDraftEvent(trimmed, [recipientPubkey], {
          addClientTag: true
        })
        await publish(draft, { disableFallbacks: true })
        showSimplePublishSuccess(t('Tip notice sent'))
        onDone()
      } catch (error) {
        if (error instanceof LoginRequiredError) return
        toast.error(
          t('Failed to send tip notice', {
            error: error instanceof Error ? error.message : String(error)
          })
        )
      } finally {
        setSending(false)
      }
    })
  }

  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{t('Tip notice prompt description')}</p>
      <div className="mt-3 min-w-0 max-w-full">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending}
          rows={6}
          className="min-h-[10rem] w-full max-w-full resize-y box-border text-sm leading-relaxed focus-visible:ring-inset"
          aria-label={t('Tip notice prompt description')}
        />
      </div>
      {previewEvent ? (
        <div className="mt-4 min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{t('Preview')}</p>
          <div
            className={cn(
              'mt-1.5 max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded-md border border-border',
              'bg-muted/25 px-3 py-2'
            )}
          >
            <MarkdownArticle event={previewEvent} hideMetadata lazyMedia={false} className="text-sm" />
          </div>
        </div>
      ) : null}
      <DialogFooter className="mt-4 flex w-full min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="w-full min-w-0 sm:w-auto" onClick={onBack} disabled={sending}>
          {t('Back')}
        </Button>
        <Button
          type="button"
          className="w-full min-w-0 sm:w-auto"
          onClick={handleSend}
          disabled={sending || !message.trim()}
        >
          {t('Send')}
        </Button>
      </DialogFooter>
    </div>
  )
}
