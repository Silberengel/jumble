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
import { createPublicMessageDraftEvent } from '@/lib/draft-event'
import { showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { pubkeyToNpub } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import UserAvatar from '../UserAvatar'
import Username from '../Username'

const TIP_NOTICE_DEFAULT_KEY = 'I just sent you a tip!'

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
  const cancelRef = useRef<HTMLButtonElement>(null)

  const tipText = t(TIP_NOTICE_DEFAULT_KEY)
  const npub = recipientPubkey ? pubkeyToNpub(recipientPubkey) : null
  const previewContent = npub ? `nostr:${npub} ${tipText}` : tipText

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      cancelRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  const handleSend = () => {
    if (!recipientPubkey) return
    checkLogin(async () => {
      if (selfPubkey === recipientPubkey) {
        onOpenChange(false)
        return
      }
      setSending(true)
      try {
        const draft = await createPublicMessageDraftEvent(previewContent, [recipientPubkey], {
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
    <>
      <p className="text-sm font-medium text-foreground">{t('Tip notice success only note')}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('Tip notice prompt description')}</p>
      <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm break-words">{previewContent}</p>
    </>
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
        disabled={sending || !recipientPubkey}
      >
        {t('Send')}
      </Button>
    </>
  )

  if (!recipientPubkey) return null

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="px-4 pb-6" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              {t('Tip notice prompt title')}
              <UserAvatar size="small" userId={recipientPubkey} />
              <Username userId={recipientPubkey} className="truncate" />
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
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('Tip notice prompt title')}
            <UserAvatar size="small" userId={recipientPubkey} />
            <Username userId={recipientPubkey} className="truncate" />
          </DialogTitle>
          <DialogDescription>{t('Tip notice prompt description')}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="gap-2 sm:gap-2">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
