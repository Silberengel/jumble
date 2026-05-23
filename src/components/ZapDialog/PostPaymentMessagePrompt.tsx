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
import { type PostPaymentContext } from '@/lib/post-payment-context'
import { cn } from '@/lib/utils'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UserAvatar from '../UserAvatar'
import Username from '../Username'
import PublicMessageForm from './PublicMessageForm'
import SuperchatRequestForm from './SuperchatRequestForm'

type Step = 'choice' | 'public-message' | 'superchat'

function ChoiceButton({
  title,
  hint,
  onClick,
  disabled
}: {
  title: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border border-border bg-muted/30 px-4 py-3 text-left transition-colors',
        'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50'
      )}
    >
      <span className="block text-sm font-medium text-foreground">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
    </button>
  )
}

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
  const closeRef = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState<Step>('choice')

  useEffect(() => {
    if (open) {
      setStep('choice')
    }
  }, [open, recipientPubkey])

  useEffect(() => {
    if (!open || step !== 'choice') return
    const id = requestAnimationFrame(() => closeRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, step])

  if (!recipientPubkey) return null

  const handleClose = () => onOpenChange(false)

  const choiceBody = (
    <div className="min-w-0 space-y-3">
      <p className="text-sm font-medium text-foreground">{t('Post payment prompt label')}</p>
      <div className="space-y-2">
        <ChoiceButton
          title={t('Send them a public message')}
          hint={t('Post payment public message hint')}
          onClick={() => setStep('public-message')}
        />
        <ChoiceButton
          title={t('Request a superchat')}
          hint={t('Post payment superchat hint')}
          onClick={() => setStep('superchat')}
        />
      </div>
    </div>
  )

  const choiceActions = (
    <Button ref={closeRef} type="button" variant="default" onClick={handleClose}>
      {t('Close')}
    </Button>
  )

  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0">{t('Send them a message')}</span>
      <UserAvatar size="small" userId={recipientPubkey} className="shrink-0" />
      <Username userId={recipientPubkey} className="min-w-0 flex-1 truncate" />
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

  const footer =
    step === 'choice' ? (
      isSmallScreen ? (
        choiceActions
      ) : (
        <DialogFooter className="gap-2 sm:gap-2">{choiceActions}</DialogFooter>
      )
    ) : null

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="min-w-0 overflow-hidden px-4 pb-6" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            {step === 'choice' ? (
              <DialogDescription className="sr-only">{t('Post payment prompt label')}</DialogDescription>
            ) : null}
          </DrawerHeader>
          <div className="px-0 pb-4">{body}</div>
          {footer ? <DrawerFooter className="flex-row justify-end gap-2 pt-2">{footer}</DrawerFooter> : null}
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
          <DialogTitle>{title}</DialogTitle>
          {step === 'choice' ? (
            <DialogDescription className="sr-only">{t('Post payment prompt label')}</DialogDescription>
          ) : null}
        </DialogHeader>
        {body}
        {footer}
      </DialogContent>
    </Dialog>
  )
}
