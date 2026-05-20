import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useZap } from '@/providers/ZapProvider'
import { useBtcUsdRate } from '@/hooks/useBtcUsdRate'
import { clampZapSats, formatSatsGrouped, shouldHighlightLeadingSatsGroups } from '@/lib/lightning'
import { formatBtcFromSats, formatUsdFromSats } from '@/lib/sats-fiat'
import { cn } from '@/lib/utils'
import lightning from '@/services/lightning.service'
import noteStatsService from '@/services/note-stats.service'
import { NostrEvent } from 'nostr-tools'
import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  buildOrderedZapLightningAddresses,
  prepareZapDialogAlternativePayments,
  ZAP_HIDE_BITCOIN_ALTS_MAX_SATS
} from '@/lib/merge-payment-methods'
import PaymentMethodsSection from '@/components/PaymentMethodsSection'
import {
  mergeRecipientZapPaymentData,
  useRecipientZapPaymentData,
  type RecipientZapPaymentData
} from '@/hooks/useRecipientAlternativePayments'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import TipPublicMessagePrompt from './TipPublicMessagePrompt'
import ZapSatsAmountInput from './ZapSatsAmountInput'
import UserAvatar from '../UserAvatar'
import Username from '../Username'

export default function ZapDialog({
  open,
  setOpen,
  pubkey,
  event,
  defaultAmount,
  defaultComment,
  defaultLightningAddress,
  prefetchedPayment = null
}: {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  pubkey: string
  event?: NostrEvent
  defaultAmount?: number
  defaultComment?: string
  /** Lightning address to pre-select (e.g. from a profile payto link click). */
  defaultLightningAddress?: string | null
  /** Profile/feed snapshot shown immediately; relay fetch while open may enrich this. */
  prefetchedPayment?: RecipientZapPaymentData | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const drawerContentRef = useRef<HTMLDivElement | null>(null)
  const { pubkey: selfPubkey } = useNostr()
  const [tipNoticeOpen, setTipNoticeOpen] = useState(false)
  const skipTipNoticeOnCloseRef = useRef(false)

  const fetchedPayment = useRecipientZapPaymentData(pubkey, open)
  const recipientPayment = useMemo(
    () => mergeRecipientZapPaymentData(prefetchedPayment, fetchedPayment),
    [prefetchedPayment, fetchedPayment]
  )
  const lightningAddressOptions = useMemo(
    () =>
      buildOrderedZapLightningAddresses({
        profileEvent: recipientPayment.profileEvent,
        profile: recipientPayment.profile,
        paymentInfo: recipientPayment.paymentInfo,
        preferredAddress: defaultLightningAddress
      }),
    [
      recipientPayment.profileEvent,
      recipientPayment.profile,
      recipientPayment.paymentInfo,
      defaultLightningAddress
    ]
  )
  const canLightningZap = lightningAddressOptions.length > 0
  const dialogTitlePrefix = canLightningZap ? t('Zap to') : t('Pay to')
  const dialogDescription = canLightningZap
    ? t('Send a Lightning payment to this user')
    : t('Send a payment to this user')

  const maybeOfferTipNoticeOnClose = () => {
    if (skipTipNoticeOnCloseRef.current) return
    if (selfPubkey && pubkey === selfPubkey) return
    setTipNoticeOpen(true)
  }

  const handleZapDialogOpenChange: Dispatch<SetStateAction<boolean>> = (next) => {
    const willOpen = typeof next === 'function' ? next(open) : next
    if (!willOpen) {
      maybeOfferTipNoticeOnClose()
      skipTipNoticeOnCloseRef.current = false
    } else {
      skipTipNoticeOnCloseRef.current = false
    }
    setOpen(next)
  }

  useEffect(() => {
    const handleResize = () => {
      if (drawerContentRef.current) {
        // Use visual viewport height to ensure proper positioning when keyboard/emoji picker opens
        const viewportHeight = window.visualViewport?.height || window.innerHeight
        
        // Ensure drawer doesn't go above the viewport, but don't override bottom positioning
        const maxHeight = viewportHeight - 100 // Leave some space at top
        drawerContentRef.current.style.setProperty('max-height', `${maxHeight}px`)
        // Don't set bottom position here - let the drawer handle it naturally
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
      handleResize() // Initial call in case the keyboard is already open
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize)
      }
    }
  }, [])

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={handleZapDialogOpenChange}>
        <DrawerOverlay onClick={() => handleZapDialogOpenChange(false)} />
        <DrawerContent
          hideOverlay
          onOpenAutoFocus={(e) => e.preventDefault()}
          ref={drawerContentRef}
          className="flex max-h-[80vh] flex-col overflow-y-auto overscroll-contain"
          style={{
            maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)',
            paddingBottom: '0' // Remove default padding since we handle it in the button container
          }}
        >
          <DrawerHeader className="shrink-0 px-4">
            <DrawerTitle className="flex gap-2 items-center">
              <div className="shrink-0">{dialogTitlePrefix}</div>
              <UserAvatar size="small" userId={pubkey} />
              <Username userId={pubkey} className="truncate flex-1 w-0 text-start h-5" />
            </DrawerTitle>
            <DialogDescription className="sr-only">{dialogDescription}</DialogDescription>
          </DrawerHeader>
          <ZapDialogContent
            open={open}
            setOpen={handleZapDialogOpenChange}
            recipient={pubkey}
            event={event}
            defaultAmount={defaultAmount}
            defaultComment={defaultComment}
            recipientPayment={recipientPayment}
            lightningAddressOptions={lightningAddressOptions}
            canLightningZap={canLightningZap}
            onBeforeZapDialogClose={(withPublicReceipt) => {
              if (withPublicReceipt) skipTipNoticeOnCloseRef.current = true
            }}
          />
        </DrawerContent>
        <TipPublicMessagePrompt
          open={tipNoticeOpen}
          onOpenChange={setTipNoticeOpen}
          recipientPubkey={pubkey}
        />
      </Drawer>
    )
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleZapDialogOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex gap-2 items-center">
            <div className="shrink-0">{dialogTitlePrefix}</div>
            <UserAvatar size="small" userId={pubkey} />
            <Username userId={pubkey} className="truncate flex-1 max-w-fit text-start h-5" />
          </DialogTitle>
          <DialogDescription className="sr-only">{dialogDescription}</DialogDescription>
        </DialogHeader>
        <ZapDialogContent
          open={open}
          setOpen={handleZapDialogOpenChange}
          recipient={pubkey}
          event={event}
          defaultAmount={defaultAmount}
          defaultComment={defaultComment}
          recipientPayment={recipientPayment}
          lightningAddressOptions={lightningAddressOptions}
          canLightningZap={canLightningZap}
          onBeforeZapDialogClose={(withPublicReceipt) => {
            if (withPublicReceipt) skipTipNoticeOnCloseRef.current = true
          }}
        />
      </DialogContent>
    </Dialog>
    <TipPublicMessagePrompt
      open={tipNoticeOpen}
      onOpenChange={setTipNoticeOpen}
      recipientPubkey={pubkey}
    />
    </>
  )
}

function ZapDialogContent({
  open,
  setOpen,
  recipient,
  event,
  defaultAmount,
  defaultComment,
  recipientPayment,
  lightningAddressOptions,
  canLightningZap,
  onBeforeZapDialogClose
}: {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  recipient: string
  event?: NostrEvent
  defaultAmount?: number
  defaultComment?: string
  recipientPayment: RecipientZapPaymentData
  lightningAddressOptions: string[]
  canLightningZap: boolean
  /** Runs before the zap dialog closes (e.g. after payment); skip tip notice if a public receipt was sent. */
  onBeforeZapDialogClose?: (withPublicReceipt: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const { pubkey } = useNostr()
  const { defaultZapSats, defaultZapComment, includePublicZapReceipt, updateIncludePublicZapReceipt } =
    useZap()
  const [sats, setSats] = useState(() => clampZapSats(defaultAmount ?? defaultZapSats))
  const [comment, setComment] = useState(defaultComment ?? defaultZapComment)
  const [zapping, setZapping] = useState(false)
  const [selectedLightning, setSelectedLightning] = useState('')
  const btcUsd = useBtcUsdRate()
  const clampedSats = clampZapSats(sats)
  const highlightLargeAmount = shouldHighlightLeadingSatsGroups(clampedSats)
  const btcEquivalent = useMemo(() => formatBtcFromSats(clampedSats), [clampedSats])
  const usdEquivalent = useMemo(() => formatUsdFromSats(clampedSats, btcUsd), [clampedSats, btcUsd])

  const { alternativeGroups } = recipientPayment

  useEffect(() => {
    if (!open) return
    setSelectedLightning(lightningAddressOptions[0] ?? '')
  }, [open, lightningAddressOptions])

  const zapAlternativePayments = useMemo(
    () =>
      prepareZapDialogAlternativePayments(
        alternativeGroups,
        canLightningZap ? clampedSats : ZAP_HIDE_BITCOIN_ALTS_MAX_SATS
      ),
    [alternativeGroups, clampedSats, canLightningZap]
  )

  const hasAlternativePayments = zapAlternativePayments.groups.length > 0

  const presetAmounts = useMemo(() => {
    if (i18n.language.startsWith('zh')) {
      return [
        { display: '21', val: 21 },
        { display: '66', val: 66 },
        { display: '210', val: 210 },
        { display: '666', val: 666 },
        { display: '1k', val: 1000 },
        { display: '2.1k', val: 2100 },
        { display: '6.6k', val: 6666 },
        { display: '10k', val: 10000 },
        { display: '21k', val: 21000 },
        { display: '66k', val: 66666 },
        { display: '100k', val: 100000 },
        { display: '210k', val: 210000 }
      ]
    }

    return [
      { display: '21', val: 21 },
      { display: '42', val: 42 },
      { display: '210', val: 210 },
      { display: '420', val: 420 },
      { display: '1k', val: 1000 },
      { display: '2.1k', val: 2100 },
      { display: '4.2k', val: 4200 },
      { display: '10k', val: 10000 },
      { display: '21k', val: 21000 },
      { display: '42k', val: 42000 },
      { display: '100k', val: 100000 },
      { display: '210k', val: 210000 }
    ]
  }, [i18n.language])

  const handleZap = async () => {
    try {
      if (!pubkey) {
        throw new Error('You need to be logged in to zap')
      }
      setZapping(true)
      const closeZapDialog = () => {
        onBeforeZapDialogClose?.(includePublicZapReceipt)
        setOpen(false)
      }
      const zapResult = await lightning.zap(
        pubkey,
        event ?? recipient,
        clampedSats,
        comment,
        closeZapDialog,
        includePublicZapReceipt,
        {
          address: selectedLightning || undefined,
          candidates: lightningAddressOptions.length > 0 ? lightningAddressOptions : undefined
        }
      )
      // user canceled
      if (!zapResult) {
        return
      }
      if (event) {
        noteStatsService.addZap(pubkey, event.id, zapResult.invoice, clampedSats, comment)
      }
    } catch (error) {
      toast.error(`${t('Zap failed')}: ${(error as Error).message}`)
    } finally {
      setZapping(false)
    }
  }

  if (!canLightningZap) {
    return (
      <div
        className="px-4 pb-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        {hasAlternativePayments ? (
          <PaymentMethodsSection
            groups={zapAlternativePayments.groups}
            recipientPubkey={recipient}
            title={t('Payment methods')}
            headerHelpText={
              zapAlternativePayments.showBitcoinOnChainHint
                ? t('Tips above 10k sats can use Bitcoin on-chain.')
                : undefined
            }
            className="rounded-lg border border-border bg-muted/40 p-3 min-w-0"
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('No payment methods available for this profile')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-4">
        {/* Sats slider or input */}
        <div className="flex flex-col items-center px-4">
          <div
            className="mb-1 flex min-h-[1.125rem] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            <span
              className={cn(
                highlightLargeAmount &&
                  'rounded-md bg-yellow-400/25 px-2 py-0.5 font-semibold text-yellow-200 shadow-[0_0_12px_rgba(250,204,21,0.45)] ring-1 ring-yellow-400/70'
              )}
            >
              {btcEquivalent}
            </span>
            {usdEquivalent != null ? (
              <>
                <span className="text-muted-foreground/40" aria-hidden>
                  ·
                </span>
                <span>{usdEquivalent}</span>
              </>
            ) : null}
          </div>
          <ZapSatsAmountInput sats={sats} onSatsChange={setSats} />
          <Label htmlFor="sats">{t('Sats')}</Label>
        </div>

        {/* Preset sats buttons */}
        <div className="grid grid-cols-6 gap-2 px-4">
          {presetAmounts.map(({ display, val }) => (
            <Button variant="secondary" key={val} onClick={() => setSats(clampZapSats(val))}>
              {display}
            </Button>
          ))}
        </div>

        {/* Comment input */}
        <div className="px-4">
          <Label htmlFor="comment">{t('zapComment')}</Label>
          <Input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </div>

      <div
        className="space-y-3 border-t border-border bg-background px-4 pt-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="zap-include-receipt" className="flex-1 cursor-pointer">
            <div className="text-sm font-medium">{t('Include public zap receipt')}</div>
            <div className="text-xs text-muted-foreground font-normal">
              {t('When off, your zap may still succeed but a public receipt may not be published to relays')}
            </div>
          </Label>
          <Switch
            id="zap-include-receipt"
            checked={includePublicZapReceipt}
            onCheckedChange={updateIncludePublicZapReceipt}
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label
            htmlFor={
              lightningAddressOptions.length > 1 ? 'zap-lightning-address' : undefined
            }
          >
            {t('Lightning address for zap')}
          </Label>
          {lightningAddressOptions.length === 1 ? (
            <p
              id="zap-lightning-address"
              className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
            >
              <span className="shrink-0 text-lg leading-none text-yellow-400" aria-hidden>
                ⚡
              </span>
              <span className="min-w-0 break-all">{lightningAddressOptions[0]}</span>
            </p>
          ) : (
            <Select value={selectedLightning} onValueChange={setSelectedLightning}>
              <SelectTrigger id="zap-lightning-address" className="min-w-0 gap-2">
                <SelectValue placeholder={t('Select lightning address')}>
                  {selectedLightning ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-lg leading-none text-yellow-400" aria-hidden>
                        ⚡
                      </span>
                      <span className="min-w-0 truncate">{selectedLightning}</span>
                    </span>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {lightningAddressOptions.map((addr) => (
                  <SelectItem key={addr} value={addr} className="break-all">
                    <span className="flex items-start gap-2">
                      <span className="shrink-0 text-lg leading-none text-yellow-400" aria-hidden>
                        ⚡
                      </span>
                      <span className="min-w-0 break-all">{addr}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Button onClick={handleZap} className="w-full">
          {zapping && <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />}{' '}
          {t('Zap n sats', { n: formatSatsGrouped(clampedSats) })}
        </Button>

        {hasAlternativePayments ? (
          <PaymentMethodsSection
            groups={zapAlternativePayments.groups}
            recipientPubkey={recipient}
            title={t('Other payment methods')}
            headerHelpText={
              zapAlternativePayments.showBitcoinOnChainHint
                ? t('Tips above 10k sats can use Bitcoin on-chain.')
                : undefined
            }
            className="rounded-lg border border-border bg-muted/40 p-3 min-w-0"
          />
        ) : null}
      </div>
    </div>
  )
}
