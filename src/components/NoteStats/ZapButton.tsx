import { ZAP_SENDING_ENABLED } from '@/constants'
import { Skeleton } from '@/components/ui/skeleton'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import {
  buildOrderedZapLightningAddresses,
  recipientHasAnyPaymentOptions
} from '@/lib/merge-payment-methods'
import {
  buildRecipientZapPaymentData,
  mergeRecipientZapPaymentData,
  type RecipientZapPaymentData
} from '@/hooks/useRecipientAlternativePayments'
import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import { shouldDeferPerPubkeyProfileNetwork } from '@/lib/profile-batch-coordinator'
import { cn } from '@/lib/utils'
import { useNoteFeedProfileContext } from '@/providers/NoteFeedProfileContext'
import { useNostr } from '@/providers/NostrProvider'
import { useZap } from '@/providers/ZapProvider'
import client, { replaceableEventService } from '@/services/client.service'
import type { TProfile } from '@/types'
import { kinds, type Event } from 'nostr-tools'
import lightning from '@/services/lightning.service'
import noteStatsService from '@/services/note-stats.service'
import type { TNoteStats } from '@/services/note-stats.service'
import { Zap } from 'lucide-react'
import { MouseEvent, TouchEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import ZapDialog from '../ZapDialog'
import TipPublicMessagePrompt from '../ZapDialog/TipPublicMessagePrompt'

type ZapButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<TNoteStats>
}

function formatAmount(amount: number) {
  if (amount < 1000) return amount
  if (amount < 1000000) return `${Math.round(amount / 100) / 10}k`
  return `${Math.round(amount / 100000) / 10}M`
}

/** Avoid one metadata + payment REQ per visible note while feed profile batch runs. */
async function resolveZapRecipientData(
  authorPubkey: string,
  feedProfile: TProfile | undefined | null
): Promise<{
  profile: TProfile | null
  profileEvent: Event | undefined
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
}> {
  const cachedFeed =
    feedProfile && !feedProfile.batchPlaceholder ? feedProfile : null
  const deferNetwork = shouldDeferPerPubkeyProfileNetwork(authorPubkey)

  const paymentPromise = deferNetwork
    ? replaceableEventService.getPaymentInfoFromIndexedDB(authorPubkey)
    : client.fetchPaymentInfoEvent(authorPubkey)

  if (cachedFeed) {
    const paymentEvent = await paymentPromise.catch(() => undefined)
    return {
      profile: cachedFeed,
      profileEvent: undefined,
      paymentInfo: paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null
    }
  }

  const idbProfile = await replaceableEventService.getProfileFromIndexedDB(authorPubkey)

  if (deferNetwork) {
    const paymentEvent = await paymentPromise.catch(() => undefined)
    return {
      profile: idbProfile ?? null,
      profileEvent: undefined,
      paymentInfo: paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null
    }
  }

  const [profileRes, paymentRes] = await Promise.allSettled([
    replaceableEventService.fetchReplaceableEvent(authorPubkey, kinds.Metadata),
    paymentPromise
  ])
  const profileEvent =
    profileRes.status === 'fulfilled' ? profileRes.value : undefined
  const paymentEvent =
    paymentRes.status === 'fulfilled' ? paymentRes.value : undefined
  const profile =
    (profileEvent ? getProfileFromEvent(profileEvent) : null) ?? idbProfile ?? null
  return {
    profile,
    profileEvent,
    paymentInfo: paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null
  }
}

/** Zap tally + payment-methods dialog when {@link ZAP_SENDING_ENABLED} is false. */
function ZapPaymentMethodsButton({ event, hideCount = false, noteStats }: ZapButtonProps) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const [openPaymentDialog, setOpenPaymentDialog] = useState(false)
  const statsLoaded = noteStats?.updatedAt != null
  const { zapAmount, hasZapped } = useMemo(() => {
    return {
      zapAmount: noteStats?.zaps?.reduce((acc, zap) => acc + zap.amount, 0),
      hasZapped: pubkey ? noteStats?.zaps?.some((zap) => zap.pubkey === pubkey) : false
    }
  }, [noteStats, pubkey])
  const showZapAmount = !hideCount && (statsLoaded || (zapAmount ?? 0) > 0)
  const authorPubkey = event.pubkey.toLowerCase()
  const isSelf = !!pubkey && pubkey.toLowerCase() === authorPubkey
  const feedProfiles = useNoteFeedProfileContext()
  const feedProfile = feedProfiles?.profiles.get(authorPubkey)
  const feedProfileRef = useRef(feedProfile)
  feedProfileRef.current = feedProfile

  const [disable, setDisable] = useState(true)
  const [tipPaymentData, setTipPaymentData] = useState<RecipientZapPaymentData | null>(null)

  const applyTipAvailability = useCallback(
    (
      profile: TProfile | null,
      profileEvent: Event | null | undefined,
      paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
    ) => {
      const canTip = recipientHasAnyPaymentOptions(
        paymentInfo,
        profile,
        profileEvent ?? null
      )
      setDisable(!canTip)
      setTipPaymentData((prev) =>
        mergeRecipientZapPaymentData(
          buildRecipientZapPaymentData(paymentInfo, profile, profileEvent ?? null),
          prev
        )
      )
    },
    []
  )

  useEffect(() => {
    if (isSelf) return
    if (!feedProfile || feedProfile.batchPlaceholder) return
    applyTipAvailability(feedProfile, null, null)
  }, [isSelf, feedProfile, feedProfiles?.version, applyTipAvailability])

  useEffect(() => {
    if (isSelf) {
      setDisable(true)
      setTipPaymentData(null)
      return
    }

    setDisable(true)
    setTipPaymentData(null)
    let cancelled = false

    void resolveZapRecipientData(authorPubkey, feedProfileRef.current).then(
      ({ profile, profileEvent, paymentInfo }) => {
        if (cancelled) return
        applyTipAvailability(profile, profileEvent ?? null, paymentInfo)
      }
    )

    return () => {
      cancelled = true
    }
  }, [authorPubkey, isSelf, feedProfiles?.version, applyTipAvailability])

  const handleOpenPaymentMethods = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (disable) return
    setOpenPaymentDialog(true)
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'group flex items-center gap-1 select-none px-3 h-full',
          disable ? 'cursor-not-allowed' : 'cursor-pointer'
        )}
        title={disable ? t('Zaps') : t('Payment methods')}
        aria-label={disable ? t('Zaps') : t('Payment methods')}
        disabled={disable}
        onClick={handleOpenPaymentMethods}
      >
        <Zap
          className={cn(
            hasZapped && 'fill-yellow-400',
            disable
              ? 'text-muted-foreground/40'
              : cn(
                  'text-muted-foreground group-hover:text-yellow-400',
                  hasZapped && 'text-yellow-400'
                )
          )}
        />
        {showZapAmount && (
          <div
            className={cn(
              'text-sm tabular-nums',
              hasZapped ? 'text-yellow-400' : 'text-muted-foreground'
            )}
          >
            {formatAmount(zapAmount ?? 0)}
          </div>
        )}
      </button>
      <ZapDialog
        open={openPaymentDialog}
        setOpen={setOpenPaymentDialog}
        pubkey={event.pubkey}
        event={event}
        prefetchedPayment={tipPaymentData}
      />
    </>
  )
}

export function ZapButtonWithStats({ event, hideCount = false, noteStats }: ZapButtonProps) {
  if (!ZAP_SENDING_ENABLED) {
    return <ZapPaymentMethodsButton event={event} hideCount={hideCount} noteStats={noteStats} />
  }

  const { t } = useTranslation()
  const { checkLogin, pubkey } = useNostr()
  const { defaultZapSats, defaultZapComment, quickZap, includePublicZapReceipt } = useZap()
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [openZapDialog, setOpenZapDialog] = useState(false)
  const [tipNoticeOpen, setTipNoticeOpen] = useState(false)
  const [zapping, setZapping] = useState(false)
  const statsLoaded = noteStats?.updatedAt != null
  const { zapAmount, hasZapped } = useMemo(() => {
    return {
      zapAmount: noteStats?.zaps?.reduce((acc, zap) => acc + zap.amount, 0),
      hasZapped: pubkey ? noteStats?.zaps?.some((zap) => zap.pubkey === pubkey) : false
    }
  }, [noteStats, pubkey])
  const showZapAmount = !hideCount && (statsLoaded || (zapAmount ?? 0) > 0)
  const authorPubkey = event.pubkey.toLowerCase()
  const isSelf = !!pubkey && pubkey.toLowerCase() === authorPubkey
  const feedProfiles = useNoteFeedProfileContext()
  const feedProfile = feedProfiles?.profiles.get(authorPubkey)
  const feedProfileRef = useRef(feedProfile)
  feedProfileRef.current = feedProfile

  const [disable, setDisable] = useState(true)
  const [canLightningZap, setCanLightningZap] = useState(false)
  const [tipPaymentData, setTipPaymentData] = useState<RecipientZapPaymentData | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPressRef = useRef(false)

  const applyTipAvailability = useCallback(
    (
      profile: TProfile | null,
      profileEvent: Event | null | undefined,
      paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null,
      forDialogPrefetch: boolean
    ) => {
      const event = profileEvent ?? null
      const canTip = recipientHasAnyPaymentOptions(paymentInfo, profile, event)
      setDisable(!canTip)
      setCanLightningZap(
        buildOrderedZapLightningAddresses({
          profileEvent: event,
          profile,
          paymentInfo
        }).length > 0
      )
      if (forDialogPrefetch) {
        setTipPaymentData((prev) =>
          mergeRecipientZapPaymentData(
            buildRecipientZapPaymentData(paymentInfo, profile, event),
            prev
          )
        )
      }
    },
    []
  )

  /** Enable zap from feed profile; seed dialog prefetch from kind 0 JSON when available. */
  useEffect(() => {
    if (isSelf) return
    if (!feedProfile || feedProfile.batchPlaceholder) return
    applyTipAvailability(feedProfile, null, null, true)
  }, [isSelf, feedProfile, feedProfiles?.version, applyTipAvailability])

  useEffect(() => {
    if (isSelf) {
      setDisable(true)
      setCanLightningZap(false)
      setTipPaymentData(null)
      return
    }

    setDisable(true)
    setCanLightningZap(false)
    setTipPaymentData(null)
    let cancelled = false

    void resolveZapRecipientData(authorPubkey, feedProfileRef.current).then(
      ({ profile, profileEvent, paymentInfo }) => {
        if (cancelled) return
        applyTipAvailability(profile, profileEvent ?? null, paymentInfo, true)
      }
    )

    return () => {
      cancelled = true
    }
  }, [authorPubkey, isSelf, feedProfiles?.version, applyTipAvailability])

  const handleZap = async () => {
    try {
      if (!pubkey) {
        throw new Error('You need to be logged in to zap')
      }
      if (zapping) return

      setZapping(true)
      const zapResult = await lightning.zap(
        pubkey,
        event,
        defaultZapSats,
        defaultZapComment,
        undefined,
        includePublicZapReceipt
      )
      // user canceled
      if (!zapResult) {
        return
      }
      noteStatsService.addZap(
        pubkey,
        event.id,
        zapResult.invoice,
        defaultZapSats,
        defaultZapComment
      )
      if (event.pubkey !== pubkey && !includePublicZapReceipt) {
        setTipNoticeOpen(true)
      }
    } catch (error) {
      toast.error(`${t('Zap failed')}: ${(error as Error).message}`)
    } finally {
      setZapping(false)
    }
  }

  const handleClickStart = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (disable) return

    isLongPressRef.current = false

    if ('touches' in e) {
      const touch = e.touches[0]
      setTouchStart({ x: touch.clientX, y: touch.clientY })
    }

    if (quickZap) {
      timerRef.current = setTimeout(() => {
        isLongPressRef.current = true
        checkLogin(() => {
          setOpenZapDialog(true)
          setZapping(true)
        })
      }, 500)
    }
  }

  const handleClickEnd = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    if (disable) return

    if ('touches' in e) {
      setTouchStart(null)
      if (!touchStart) return
      const touch = e.changedTouches[0]
      const diffX = Math.abs(touch.clientX - touchStart.x)
      const diffY = Math.abs(touch.clientY - touchStart.y)
      if (diffX > 10 || diffY > 10) return
    }

    if (!quickZap) {
      checkLogin(() => {
        setOpenZapDialog(true)
        setZapping(true)
      })
    } else if (!isLongPressRef.current) {
      if (canLightningZap) {
        checkLogin(() => handleZap())
      } else {
        checkLogin(() => {
          setOpenZapDialog(true)
          setZapping(true)
        })
      }
    }
    isLongPressRef.current = false
  }

  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
  }

  return (
    <>
      <button
        className={cn(
          'group flex items-center gap-1 select-none px-3 h-full',
          disable ? 'cursor-not-allowed' : 'cursor-pointer'
        )}
        title={t('Zap')}
        disabled={disable || zapping}
        onMouseDown={handleClickStart}
        onMouseUp={handleClickEnd}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleClickStart}
        onTouchEnd={handleClickEnd}
      >
        {zapping ? (
          <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
        ) : (
          <Zap
            className={cn(
              hasZapped && 'fill-yellow-400',
              disable
                ? 'text-muted-foreground/40'
                : cn(
                    'text-muted-foreground group-hover:text-yellow-400',
                    hasZapped && 'text-yellow-400'
                  )
            )}
          />
        )}
        {showZapAmount && (
          <div
            className={cn(
              'text-sm tabular-nums',
              hasZapped ? 'text-yellow-400' : 'text-muted-foreground'
            )}
          >
            {formatAmount(zapAmount ?? 0)}
          </div>
        )}
      </button>
      <ZapDialog
        open={openZapDialog}
        setOpen={(open) => {
          setOpenZapDialog(open)
          setZapping(open)
        }}
        pubkey={event.pubkey}
        event={event}
        prefetchedPayment={tipPaymentData}
      />
      <TipPublicMessagePrompt
        open={tipNoticeOpen}
        onOpenChange={setTipNoticeOpen}
        recipientPubkey={event.pubkey}
      />
    </>
  )
}

export default function ZapButton({ event, hideCount = false }: ZapButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  return <ZapButtonWithStats event={event} hideCount={hideCount} noteStats={noteStats} />
}
