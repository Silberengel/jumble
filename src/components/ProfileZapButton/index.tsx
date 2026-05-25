import { Button } from '@/components/ui/button'
import { useRecipientPaymentData } from '@/hooks/useRecipientAlternativePayments'
import { useNostr } from '@/providers/NostrProvider'
import { Coins } from 'lucide-react'
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

  const title = t('Leave a tip')

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        title={title}
        aria-label={title}
        onClick={() => checkLogin(() => setOpen(true))}
      >
        <Coins className="text-yellow-400" />
      </Button>
      {!setOpenZapDialog && (
        <ZapDialog open={open} setOpen={setInternalOpen} pubkey={pubkey} prefetchedPayment={recipientPayment} />
      )}
    </>
  )
}
