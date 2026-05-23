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
import { cn } from '@/lib/utils'
import { type PostPaymentContext } from '@/lib/post-payment-context'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import PublicMessageForm from './PublicMessageForm'
import SuperchatRequestForm from './SuperchatRequestForm'

type Step = 'choice' | 'public-message' | 'superchat'

const footerButtonClass = 'w-full min-w-0 sm:w-auto'

export default function PostPaymentMessagePrompt({
  open,
  onOpenChange,
  recipientPubkey,
  paymentContext
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipientPubkey: string | null
  paymentContext?: PostPaymentContext | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const superchatRef = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState<Step>('choice')

  useEffect(() => {
    if (open) {
      setStep('choice')
    }
  }, [open, recipientPubkey])

  useEffect(() => {
    if (!open || step !== 'choice') return
    const id = requestAnimationFrame(() => superchatRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, step])

  if (!recipientPubkey) return null

  const handleClose = () => onOpenChange(false)

  const choiceBody = (
    <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{t('Post payment prompt label')}</p>
  )

  const choiceActions = (
    <>
      <Button type="button" variant="outline" className={footerButtonClass} onClick={handleClose}>
        {t('Close')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className={footerButtonClass}
        onClick={() => setStep('public-message')}
      >
        {t('Send them a public message')}
      </Button>
      <Button
        ref={superchatRef}
        type="button"
        variant="default"
        className={footerButtonClass}
        onClick={() => setStep('superchat')}
      >
        {t('Request a superchat')}
      </Button>
    </>
  )

  const title = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="shrink-0">{t('Send them a message')}</span>
      <span className="inline-flex min-w-0 max-w-full items-center gap-2">
        <UserAvatar size="small" userId={recipientPubkey} className="shrink-0" />
        <Username userId={recipientPubkey} className="min-w-0 truncate" />
      </span>
    </span>
  )

  const body =
    step === 'public-message' ? (
      <PublicMessageForm
        recipientPubkey={recipientPubkey}
        onBack={() => setStep('choice')}
        onDone={handleClose}
      />
    ) : step === 'superchat' ? (
      <SuperchatRequestForm
        recipientPubkey={recipientPubkey}
        paymentContext={paymentContext}
        onBack={() => setStep('choice')}
        onDone={handleClose}
      />
    ) : (
      choiceBody
    )

  const choiceFooterClass = cn(
    'flex w-full min-w-0 flex-col-reverse gap-2',
    !isSmallScreen && 'sm:flex-row sm:flex-wrap sm:justify-end'
  )

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          className="max-h-[92dvh] min-w-0 overflow-hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DrawerHeader className="min-w-0 text-left">
            <DrawerTitle className="min-w-0 break-words">{title}</DrawerTitle>
            {step === 'choice' ? (
              <DialogDescription className="sr-only">{t('Post payment prompt label')}</DialogDescription>
            ) : null}
          </DrawerHeader>
          <div className="min-w-0 overflow-x-hidden px-0 pb-4">{body}</div>
          {step === 'choice' ? (
            <DrawerFooter className={choiceFooterClass}>{choiceActions}</DrawerFooter>
          ) : null}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[calc(100vw-1.25rem)] max-w-lg min-w-0 flex-col gap-4 overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="min-w-0 shrink-0">
          <DialogTitle className="min-w-0 break-words">{title}</DialogTitle>
          {step === 'choice' ? (
            <DialogDescription className="sr-only">{t('Post payment prompt label')}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="min-w-0 overflow-x-hidden">{body}</div>
        {step === 'choice' ? (
          <DialogFooter className={choiceFooterClass}>{choiceActions}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
