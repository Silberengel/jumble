import PostPaymentMessagePrompt from '@/components/ZapDialog/PostPaymentMessagePrompt'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ArrowRight, Copy, Wallet, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { closeModal } from '@getalby/bitcoin-connect-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { releaseBodyScrollLocks } from '@/lib/react-remove-scroll-body-cleanup'
import {
  filterPaytoPaymentOpenHandlersForDevice,
  getPaytoTypeInfo,
  isLikelyMobileWalletUserAgent,
  isPaytoHttpOpenUrl,
  openPaytoPaymentTarget,
  openPaytoResolvedUrl,
  resolvePaytoPaymentOpenHandlers,
  resolvePaytoProfileUrl
} from '@/lib/payto'
import { superchatLightningAccentClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { mergePostPaymentContext, type PostPaymentContext } from '@/lib/post-payment-context'
import { NostrEvent } from 'nostr-tools'
import QrCode from '@/components/QrCode'
import LightningInvoiceSection from './LightningInvoiceSection'

export default function PaytoDialog({
  open,
  onOpenChange,
  type,
  authority,
  paytoUri,
  recipientPubkey,
  referencedEvent,
  offerTipNoticeOnClose = true,
  onPostPaymentRequest
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: string
  authority: string
  paytoUri: string
  /** When set, the dialog offers a post-payment message prompt to this pubkey. */
  recipientPubkey?: string
  /** Note or profile context for superchat placement (kind 9740). */
  referencedEvent?: NostrEvent
  /** When false, a parent handles the post-payment prompt itself. */
  offerTipNoticeOnClose?: boolean
  /** Parent-owned post-payment UI (e.g. ZapDialog). When set, internal prompt is skipped. */
  onPostPaymentRequest?: (context: PostPaymentContext) => void
}) {
  const { t } = useTranslation()
  const { pubkey: selfPubkey } = useNostr()
  const sendMessageRef = useRef<HTMLButtonElement>(null)
  const [postPaymentOpen, setPostPaymentOpen] = useState(false)
  const [postPaymentContext, setPostPaymentContext] = useState<PostPaymentContext | null>(null)
  const [completedPaymentDetails, setCompletedPaymentDetails] = useState<
    Partial<Pick<PostPaymentContext, 'amountMsat' | 'payto' | 'messageDraft'>> | null
  >(null)
  const info = getPaytoTypeInfo(type)
  const label = info?.label ?? type
  const isLightning = type.toLowerCase() === 'lightning'
  const [bolt11Invoice, setBolt11Invoice] = useState<string | null>(null)
  const [selectedOpenHandlerId, setSelectedOpenHandlerId] = useState('')

  const canOfferPostPayment =
    !!recipientPubkey && (!selfPubkey || recipientPubkey !== selfPubkey)

  useEffect(() => {
    if (!open) {
      setBolt11Invoice(null)
      setSelectedOpenHandlerId('')
      setCompletedPaymentDetails(null)
      closeModal()
      releaseBodyScrollLocks()
    }
  }, [open])

  useEffect(() => {
    if (!open || !canOfferPostPayment) return
    const id = requestAnimationFrame(() => sendMessageRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, canOfferPostPayment])

  const closeForWalletFlow = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  const openPostPaymentPrompt = useCallback(
    (context?: Partial<PostPaymentContext>) => {
      if (!canOfferPostPayment) return
      const built = mergePostPaymentContext(
        { recipientPubkey: recipientPubkey!, referencedEvent },
        {
          paytoUri,
          paytoType: type,
          paytoAuthority: authority,
          ...completedPaymentDetails,
          ...context
        }
      )
      if (onPostPaymentRequest) {
        onPostPaymentRequest(built)
        onOpenChange(false)
        return
      }
      if (!offerTipNoticeOnClose) return
      onOpenChange(false)
      setPostPaymentContext(built)
      setPostPaymentOpen(true)
    },
    [
      canOfferPostPayment,
      offerTipNoticeOnClose,
      onPostPaymentRequest,
      recipientPubkey,
      paytoUri,
      type,
      authority,
      referencedEvent,
      completedPaymentDetails
    ]
  )

  const handleSendMessage = () => {
    onOpenChange(false)
    requestAnimationFrame(() => openPostPaymentPrompt())
  }

  const openHandlers = useMemo(
    () =>
      filterPaytoPaymentOpenHandlersForDevice(
        resolvePaytoPaymentOpenHandlers(type, authority, { bolt11Invoice })
      ),
    [type, authority, bolt11Invoice]
  )

  useEffect(() => {
    if (openHandlers.length === 0) {
      setSelectedOpenHandlerId('')
      return
    }
    setSelectedOpenHandlerId((prev) =>
      openHandlers.some((h) => h.id === prev) ? prev : openHandlers[0].id
    )
  }, [openHandlers])

  const selectedOpenHandler = useMemo(
    () =>
      openHandlers.find((h) => h.id === selectedOpenHandlerId) ??
      openHandlers[0] ??
      null,
    [openHandlers, selectedOpenHandlerId]
  )

  const walletOpenUri = useMemo(
    () => (isLightning ? null : resolvePaytoProfileUrl(type, authority)),
    [isLightning, type, authority]
  )

  /** Wallet deep link (`bitcoin:…`) or funding page URL — not the payto:// URI. */
  const qrPayload = walletOpenUri ?? authority

  const showPrimaryOpen = isLikelyMobileWalletUserAgent() && !!walletOpenUri

  const handleOpenWallet = () => {
    if (!walletOpenUri) return
    openPaytoResolvedUrl(walletOpenUri)
    closeForWalletFlow()
  }

  const handleCopy = (text: string, copyLabel?: string) => {
    navigator.clipboard.writeText(text)
    toast.success(copyLabel ? t('Copied {{label}} address', { label: copyLabel }) : t('Copied to clipboard'))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            'left-[50%] top-[50%] flex w-[calc(100vw-1.25rem)] max-w-md translate-x-[-50%] translate-y-[-50%] flex-col gap-0',
            'max-h-[min(92dvh,720px)] overflow-hidden p-0 sm:max-w-md sm:p-0',
            'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
          )}
        >
          <DialogHeader className="shrink-0 space-y-1 border-b border-border/60 px-4 pb-3 pt-4 text-left sm:px-5 sm:pt-5">
            <DialogTitle className="flex min-w-0 items-center gap-2 pr-8 text-lg sm:text-xl">
              {isLightning && <Zap className={cn('size-6 shrink-0', superchatLightningAccentClass)} />}
              <span className="truncate">{label}</span>
            </DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed sm:text-base">
              {isLightning
                ? t('Create a BOLT11 invoice from this Lightning address, then pay in your connected wallet or another app.')
                : showPrimaryOpen
                  ? t('Open in your wallet app or copy the address below.')
                  : t('Payment address – copy to use in your wallet or app')}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="min-w-0 space-y-4 px-4 py-4 sm:px-5">
            {isLightning && open ? (
              <LightningInvoiceSection
                lightningAddress={authority}
                paytoUri={paytoUri}
                onBolt11InvoiceChange={setBolt11Invoice}
                onPaymentFlowComplete={(details) => {
                  if (!details) return
                  setCompletedPaymentDetails(details)
                  if (canOfferPostPayment) {
                    requestAnimationFrame(() => openPostPaymentPrompt(details))
                  }
                }}
              />
            ) : isLightning ? null : (
              <>
                <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-border/50">
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t('Payment address')}
                  </p>
                  <p className="break-all font-mono text-base leading-relaxed select-text sm:text-lg">{authority}</p>
                </div>
                <div
                  className="flex min-w-0 flex-col items-center gap-2"
                  role="img"
                  aria-label={t('Scan to pay with your wallet')}
                >
                  <div className="w-full max-w-[min(100%,280px)]">
                    <QrCode value={qrPayload} fill />
                  </div>
                  <p className="text-center text-sm text-muted-foreground sm:text-base">
                    {t('Scan to pay with your wallet')}
                  </p>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  {showPrimaryOpen && walletOpenUri ? (
                    <Button
                      variant="default"
                      className="h-11 w-full min-w-0 gap-2 text-base"
                      onClick={handleOpenWallet}
                    >
                      <Wallet className="size-5 shrink-0" />
                      <span className="truncate">
                        {isPaytoHttpOpenUrl(walletOpenUri)
                          ? t('Open on website')
                          : t('Open in wallet')}
                      </span>
                    </Button>
                  ) : null}
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      variant={showPrimaryOpen ? 'outline' : 'default'}
                      className="h-11 w-full min-w-0 gap-2 text-base"
                      onClick={() => handleCopy(authority, label)}
                    >
                      <Copy className="size-5 shrink-0" />
                      <span className="truncate">{t('Copy address')}</span>
                    </Button>
                    <Button
                      variant={showPrimaryOpen ? 'outline' : 'secondary'}
                      className="h-11 w-full min-w-0 gap-2 text-base"
                      onClick={() => handleCopy(paytoUri)}
                    >
                      <Copy className="size-5 shrink-0" />
                      <span className="truncate">{t('Copy payto URI')}</span>
                    </Button>
                  </div>
                </div>
              </>
            )}

            {openHandlers.length > 0 && (
              <div className="min-w-0 space-y-2.5 border-t border-border/60 pt-4">
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground sm:text-base">
                  {t('Open with')}
                </p>
                <div className="flex min-w-0 items-stretch gap-2">
                  <Select
                    value={selectedOpenHandlerId}
                    onValueChange={setSelectedOpenHandlerId}
                  >
                    <SelectTrigger
                      className="h-11 min-w-0 flex-1 text-base"
                      aria-label={t('Open with')}
                    >
                      <SelectValue
                        placeholder={t('Choose app', { defaultValue: 'Choose app' })}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {openHandlers.map((handler) => (
                        <SelectItem key={handler.id} value={handler.id} className="text-base">
                          {handler.openTargetName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    disabled={!selectedOpenHandler}
                    title={
                      selectedOpenHandler
                        ? t('Open in {{name}}', { name: selectedOpenHandler.openTargetName })
                        : undefined
                    }
                    aria-label={
                      selectedOpenHandler
                        ? t('Open in {{name}}', { name: selectedOpenHandler.openTargetName })
                        : t('Open', { defaultValue: 'Open' })
                    }
                    onClick={() => {
                      if (selectedOpenHandler) openPaytoPaymentTarget(selectedOpenHandler)
                    }}
                  >
                    <ArrowRight className="size-5" aria-hidden />
                  </Button>
                </div>
              </div>
            )}
            </div>
          </div>

          {canOfferPostPayment ? (
            <DialogFooter className="flex shrink-0 flex-col gap-2 border-t border-border/60 bg-background px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
              <Button
                ref={sendMessageRef}
                type="button"
                variant="default"
                className="w-full min-w-0 sm:w-auto"
                onClick={handleSendMessage}
              >
                {t('Send a message')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full min-w-0 sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                {t('Close')}
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter className="shrink-0 border-t border-border/60 px-4 py-3 sm:px-5">
              <Button
                type="button"
                variant="outline"
                className="w-full min-w-0 sm:ml-auto sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                {t('Close')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {recipientPubkey && !onPostPaymentRequest ? (
        <PostPaymentMessagePrompt
          open={postPaymentOpen}
          onOpenChange={setPostPaymentOpen}
          recipientPubkey={recipientPubkey}
          paymentContext={postPaymentContext}
        />
      ) : null}
    </>
  )
}
