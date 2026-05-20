import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
import { Textarea } from '@/components/ui/textarea'
import { ExtendedKind } from '@/constants'
import { createPublicMessageDraftEvent } from '@/lib/draft-event'
import { createFakeEvent } from '@/lib/event'
import { showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { pubkeyToNpub } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'
import UserAvatar from '../UserAvatar'
import Username from '../Username'

const TIP_NOTICE_DEFAULT_KEY = 'I just sent you a tip!'

function defaultTipNoticeMessage(recipientPubkey: string, tipText: string): string {
  const npub = pubkeyToNpub(recipientPubkey)
  return `nostr:${npub} ${tipText}`
}

export default function TipPublicMessagePrompt({
  open,
  onOpenChange,
  recipientPubkey
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipientPubkey: string | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { publish, checkLogin, pubkey: selfPubkey } = useNostr()
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const tipText = t(TIP_NOTICE_DEFAULT_KEY)

  useEffect(() => {
    if (!open || !recipientPubkey) return
    setMessage(defaultTipNoticeMessage(recipientPubkey, tipText))
  }, [open, recipientPubkey, tipText])

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      )
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  const previewEvent = useMemo(() => {
    if (!recipientPubkey) return null
    return createFakeEvent({
      kind: ExtendedKind.PUBLIC_MESSAGE,
      pubkey: selfPubkey ?? '',
      content: message,
      tags: [['p', recipientPubkey]]
    })
  }, [message, recipientPubkey, selfPubkey])

  const handleSend = () => {
    if (!recipientPubkey) return
    const trimmed = message.trim()
    if (!trimmed) return
    checkLogin(async () => {
      if (selfPubkey === recipientPubkey) {
        onOpenChange(false)
        return
      }
      setSending(true)
      try {
        const draft = await createPublicMessageDraftEvent(trimmed, [recipientPubkey], {
          addClientTag: true
        })
        await publish(draft, { disableFallbacks: true })
        showSimplePublishSuccess(t('Tip notice sent'))
        onOpenChange(false)
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

  const body = (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{t('Tip notice success only note')}</p>
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={sending}
        rows={6}
        className="mt-3 min-h-[10rem] resize-y text-sm leading-relaxed"
        aria-label={t('Tip notice prompt description')}
      />
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
    </div>
  )

  const actions = (
    <>
      <Button
        ref={cancelRef}
        type="button"
        variant="default"
        onClick={() => onOpenChange(false)}
        disabled={sending}
      >
        {t('Cancel')}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={handleSend}
        disabled={sending || !recipientPubkey || !message.trim()}
      >
        {t('Send')}
      </Button>
    </>
  )

  if (!recipientPubkey) return null

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="min-w-0 overflow-hidden px-4 pb-6" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DrawerHeader>
            <DrawerTitle className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">{t('Tip notice prompt title')}</span>
              <UserAvatar size="small" userId={recipientPubkey} className="shrink-0" />
              <Username userId={recipientPubkey} className="min-w-0 flex-1 truncate" />
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-0 pb-4">{body}</div>
          <DrawerFooter className="flex-row justify-end gap-2 pt-2">{actions}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-lg min-w-0 overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">{t('Tip notice prompt title')}</span>
            <UserAvatar size="small" userId={recipientPubkey} className="shrink-0" />
            <Username userId={recipientPubkey} className="min-w-0 flex-1 truncate" />
          </DialogTitle>
          <DialogDescription>{t('Tip notice prompt description')}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="gap-2 sm:gap-2">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
