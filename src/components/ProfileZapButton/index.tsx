import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLongPressAction } from '@/hooks/use-long-press-action'
import { useNip57QuickZap } from '@/hooks/useNip57QuickZap'
import { useRecipientPaymentData } from '@/hooks/useRecipientAlternativePayments'
import { useNostr } from '@/providers/NostrProvider'
import { Zap } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ZapDialog from '../ZapDialog'

export default function ProfileZapButton({
  pubkey,
  openZapDialog,
  setOpenZapDialog
}: {
  pubkey: string
  openZapDialog?: boolean
  setOpenZapDialog?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = setOpenZapDialog ? (openZapDialog ?? false) : internalOpen
  const setOpen = setOpenZapDialog ?? setInternalOpen
  const recipientPayment = useRecipientPaymentData(pubkey, true)

  const { canQuickNip57Zap, sendQuickZap, zapping } = useNip57QuickZap({
    recipientPubkey: pubkey,
    recipientPayment,
    onZapDialogClose: () => setOpen(false)
  })

  const longPressZap = useLongPressAction(() => sendQuickZap(), { enabled: canQuickNip57Zap })

  const title = canQuickNip57Zap ? t('Payment methods — long-press to zap') : t('Payment methods')

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        title={title}
        aria-label={title}
        disabled={zapping}
        onClick={() => {
          if (longPressZap.consumeIfLongPress()) return
          checkLogin(() => setOpen(true))
        }}
        onPointerDown={longPressZap.onPointerDown}
        onPointerUp={longPressZap.onPointerUp}
        onPointerLeave={longPressZap.onPointerLeave}
        onPointerCancel={longPressZap.onPointerCancel}
      >
        {zapping ? (
          <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
        ) : (
          <Zap className="text-yellow-400" />
        )}
      </Button>
      {!setOpenZapDialog && (
        <ZapDialog open={open} setOpen={setInternalOpen} pubkey={pubkey} prefetchedPayment={recipientPayment} />
      )}
    </>
  )
}
