import TipPublicMessagePrompt from '@/components/ZapDialog/TipPublicMessagePrompt'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy, ExternalLink, Wallet, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { closeModal } from '@getalby/bitcoin-connect-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { releaseBodyScrollLocks } from '@/lib/react-remove-scroll-body-cleanup'
import {
  filterPaytoPaymentOpenHandlersForDevice,
  getPaytoPaymentOpenHandlers,
  getPhoenixPaymentOpenHandler,
  getPaytoTypeInfo
} from '@/lib/payto'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import LightningInvoiceSection from './LightningInvoiceSection'

export default function PaytoDialog({
  open,
  onOpenChange,
  type,
  authority,
  paytoUri,
  recipientPubkey,
  offerTipNoticeOnClose = true
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: string
  authority: string
  paytoUri: string
  /** When set, closing the dialog offers a kind-24 tip notice to this pubkey. */
  recipientPubkey?: string
  /** When false, a parent (e.g. ZapDialog) will offer the tip notice on its own close. */
  offerTipNoticeOnClose?: boolean
}) {
  const { t } = useTranslation()
  const { pubkey: selfPubkey } = useNostr()
  const [tipNoticeOpen, setTipNoticeOpen] = useState(false)
  const skipTipNoticeOnCloseRef = useRef(false)
  const info = getPaytoTypeInfo(type)
  const label = info?.label ?? type
  const isLightning = type.toLowerCase() === 'lightning'
  const [bolt11Invoice, setBolt11Invoice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setBolt11Invoice(null)
      closeModal()
      releaseBodyScrollLocks()
    }
  }, [open])

  const closeForWalletFlow = useCallback(() => {
    skipTipNoticeOnCloseRef.current = true
    onOpenChange(false)
  }, [onOpenChange])

  const openHandlers = useMemo(() => {
    const handlers = getPaytoPaymentOpenHandlers(type, authority)
    if (isLightning && bolt11Invoice) {
      const phoenix = getPhoenixPaymentOpenHandler('lightning', bolt11Invoice)
      if (phoenix) handlers.push(phoenix)
    }
    return filterPaytoPaymentOpenHandlersForDevice(handlers)
  }, [type, authority, isLightning, bolt11Invoice])

  const handleCopy = (text: string, copyLabel?: string) => {
    navigator.clipboard.writeText(text)
    toast.success(copyLabel ? t('Copied {{label}} address', { label: copyLabel }) : t('Copied to clipboard'))
    handleDialogOpenChange(false)
  }

  const maybeOfferTipNotice = useCallback(() => {
    if (!offerTipNoticeOnClose) return
    if (!recipientPubkey) return
    if (selfPubkey && recipientPubkey === selfPubkey) return
    setTipNoticeOpen(true)
  }, [offerTipNoticeOnClose, recipientPubkey, selfPubkey])

  const maybeOfferTipNoticeOnClose = () => {
    if (skipTipNoticeOnCloseRef.current) return
    maybeOfferTipNotice()
  }

  const handleDialogOpenChange = (next: boolean) => {
    if (!next) {
      maybeOfferTipNoticeOnClose()
      skipTipNoticeOnCloseRef.current = false
    } else {
      skipTipNoticeOnCloseRef.current = false
    }
    onOpenChange(next)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className={cn(
          'left-[50%] top-[50%] flex w-[calc(100vw-1.25rem)] max-w-md translate-x-[-50%] translate-y-[-50%] flex-col gap-0',
          'max-h-[min(92dvh,720px)] overflow-x-hidden overflow-y-auto p-0 sm:max-w-md sm:p-0',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-4 pb-3 pt-4 text-left sm:px-5 sm:pt-5">
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-8 text-lg sm:text-xl">
            {isLightning && <Zap className="size-6 shrink-0 text-yellow-400" />}
            <span className="truncate">{label}</span>
          </DialogTitle>
          <DialogDescription className="text-left text-sm leading-relaxed sm:text-base">
            {isLightning
              ? t('Create a BOLT11 invoice from this Lightning address, then pay in your connected wallet or another app.')
              : t('Payment address – copy to use in your wallet or app')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 px-4 py-4 sm:px-5">
          {isLightning && open ? (
            <LightningInvoiceSection
              lightningAddress={authority}
              paytoUri={paytoUri}
              onBolt11InvoiceChange={setBolt11Invoice}
              onRequestClose={closeForWalletFlow}
              onPaymentSuccess={maybeOfferTipNotice}
            />
          ) : isLightning ? null : (
            <>
              <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-border/50">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('Payment address')}
                </p>
                <p className="break-all font-mono text-base leading-relaxed select-text sm:text-lg">{authority}</p>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  variant="default"
                  className="h-11 w-full min-w-0 gap-2 text-base"
                  onClick={() => handleCopy(authority, label)}
                >
                  <Copy className="size-5 shrink-0" />
                  <span className="truncate">{t('Copy address')}</span>
                </Button>
                <Button
                  variant="secondary"
                  className="h-11 w-full min-w-0 gap-2 text-base"
                  onClick={() => handleCopy(paytoUri)}
                >
                  <Copy className="size-5 shrink-0" />
                  <span className="truncate">{t('Copy payto URI')}</span>
                </Button>
              </div>
            </>
          )}

          {openHandlers.length > 0 && (
            <div className="min-w-0 space-y-2.5 border-t border-border/60 pt-4">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground sm:text-base">
                {t('Open with')}
              </p>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {openHandlers.map((handler) => (
                  <Button
                    key={handler.id}
                    variant="outline"
                    className="h-11 w-full min-w-0 justify-start gap-2 px-3 text-base"
                    asChild
                  >
                    <a
                      href={handler.href}
                      className="flex min-w-0 items-center"
                      {...(handler.isHttp
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {handler.isHttp ? (
                        <ExternalLink className="size-5 shrink-0" />
                      ) : (
                        <Wallet className="size-5 shrink-0" />
                      )}
                      <span className="truncate">{t('Open in {{name}}', { name: handler.openTargetName })}</span>
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    {recipientPubkey ? (
      <TipPublicMessagePrompt
        open={tipNoticeOpen}
        onOpenChange={setTipNoticeOpen}
        recipientPubkey={recipientPubkey}
      />
    ) : null}
    </>
  )
}
