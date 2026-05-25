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
import PaymentMethodsSection from '@/components/PaymentMethodsSection'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useNip57QuickZap } from '@/hooks/useNip57QuickZap'
import { useSenderPaytoTypes } from '@/hooks/useSenderPaytoTypes'
import {
  mergeRecipientPaymentData,
  useRecipientPaymentData,
  type RecipientPaymentData
} from '@/hooks/useRecipientAlternativePayments'
import {
  groupPaymentMethodsForDisplay,
  mergePaymentMethods,
  sortMergedPaymentMethods
} from '@/lib/merge-payment-methods'
import { mergePostPaymentContext, type PostPaymentContext } from '@/lib/post-payment-context'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { NostrEvent } from 'nostr-tools'
import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostPaymentMessagePrompt from './PostPaymentMessagePrompt'
import Nip57QuickZapButton from './Nip57QuickZapButton'

export default function ZapDialog({
  open,
  setOpen,
  pubkey,
  event,
  prefetchedPayment = null,
  onPostPaymentRequest
}: {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  pubkey: string
  /** When set, kind 9740 superchats reference this note (e/a + k + author). Omit for profile tips. */
  event?: NostrEvent
  /** Profile/feed snapshot shown immediately; relay fetch while open may enrich this. */
  prefetchedPayment?: RecipientPaymentData | null
  /** Parent-owned post-payment prompt (e.g. note ZapButton). Skips internal prompt when set. */
  onPostPaymentRequest?: (context: PostPaymentContext) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const drawerContentRef = useRef<HTMLDivElement | null>(null)
  const { pubkey: selfPubkey } = useNostr()
  const [postPaymentOpen, setPostPaymentOpen] = useState(false)
  const [postPaymentContext, setPostPaymentContext] = useState<PostPaymentContext | null>(null)

  const openPostPaymentPrompt = (context?: PostPaymentContext | null) => {
    if (selfPubkey && pubkey === selfPubkey) return
    const built = mergePostPaymentContext(
      { recipientPubkey: pubkey, referencedEvent: event },
      context ?? undefined
    )
    if (onPostPaymentRequest) {
      onPostPaymentRequest(built)
      setOpen(false)
      return
    }
    setPostPaymentContext(built)
    setPostPaymentOpen(true)
    setOpen(false)
  }

  const fetchedPayment = useRecipientPaymentData(pubkey, open)
  const recipientPayment = useMemo(
    () => mergeRecipientPaymentData(prefetchedPayment, fetchedPayment),
    [prefetchedPayment, fetchedPayment]
  )
  const senderPaytoTypes = useSenderPaytoTypes(open)

  const paymentGroups = useMemo(() => {
    const merged = sortMergedPaymentMethods(
      mergePaymentMethods(
        recipientPayment.paymentInfo,
        recipientPayment.profile,
        recipientPayment.profileEvent
      )
    )
    return groupPaymentMethodsForDisplay(merged, senderPaytoTypes)
  }, [recipientPayment, senderPaytoTypes])

  const { canQuickNip57Zap, quickZapLabel, sendQuickZap, zapping } = useNip57QuickZap({
    recipientPubkey: pubkey,
    referencedEvent: event,
    recipientPayment,
    onPostPaymentRequest: openPostPaymentPrompt,
    onZapDialogClose: () => setOpen(false)
  })

  const dialogTitle = t('Payment methods')
  const body =
    paymentGroups.length > 0 || canQuickNip57Zap ? (
      <>
        {canQuickNip57Zap ? (
          <Nip57QuickZapButton label={quickZapLabel} zapping={zapping} onClick={sendQuickZap} />
        ) : null}
        {paymentGroups.length > 0 ? (
          <PaymentMethodsSection
            groups={paymentGroups}
            recipientPubkey={pubkey}
            referencedEvent={event}
            offerTipNoticeOnClose={false}
            onPostPaymentRequest={openPostPaymentPrompt}
            title={t('Payment methods')}
            className="rounded-lg border border-border bg-muted/40 p-3 min-w-0"
          />
        ) : null}
      </>
    ) : (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('No payment methods available for this profile')}
      </p>
    )

  const content = (
    <div
      className="px-4 pb-4"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      {body}
    </div>
  )

  const postPaymentPrompt = !onPostPaymentRequest ? (
    <PostPaymentMessagePrompt
      open={postPaymentOpen}
      onOpenChange={setPostPaymentOpen}
      recipientPubkey={pubkey}
      paymentContext={postPaymentContext}
    />
  ) : null

  useEffect(() => {
    const handleResize = () => {
      if (drawerContentRef.current) {
        const viewportHeight = window.visualViewport?.height || window.innerHeight
        const maxHeight = viewportHeight - 100
        drawerContentRef.current.style.setProperty('max-height', `${maxHeight}px`)
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
      handleResize()
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize)
      }
    }
  }, [])

  if (isSmallScreen) {
    return (
      <>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerOverlay onClick={() => setOpen(false)} />
          <DrawerContent
            hideOverlay
            onOpenAutoFocus={(e) => e.preventDefault()}
            ref={drawerContentRef}
            className="flex max-h-[80vh] flex-col overflow-y-auto overscroll-contain"
            style={{
              maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)',
              paddingBottom: '0'
            }}
          >
            <DrawerHeader className="shrink-0 px-4">
              <DrawerTitle className="flex items-center gap-2">
                <div className="shrink-0">{dialogTitle}</div>
                <UserAvatar size="small" userId={pubkey} />
                <Username userId={pubkey} className="h-5 w-0 flex-1 truncate text-start" />
              </DrawerTitle>
              <DialogDescription className="sr-only">{dialogTitle}</DialogDescription>
            </DrawerHeader>
            {content}
          </DrawerContent>
        </Drawer>
        {postPaymentPrompt}
      </>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="shrink-0">{dialogTitle}</div>
              <UserAvatar size="small" userId={pubkey} />
              <Username userId={pubkey} className="h-5 max-w-fit flex-1 truncate text-start" />
            </DialogTitle>
            <DialogDescription className="sr-only">{dialogTitle}</DialogDescription>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>
      {postPaymentPrompt}
    </>
  )
}
