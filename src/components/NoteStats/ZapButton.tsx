import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { useSatsFiatRates } from '@/hooks/useSatsFiatRates'
import {
  displayTotalTipSats,
  noteStatsHasResolvableCounts
} from '@/services/note-stats.service'
import { recipientHasAnyPaymentOptions } from '@/lib/merge-payment-methods'
import {
  buildRecipientPaymentData,
  mergeRecipientPaymentData,
  type RecipientPaymentData
} from '@/hooks/useRecipientAlternativePayments'
import { getPaymentInfoFromEvent, getProfileFromEvent } from '@/lib/event-metadata'
import { shouldDeferPerPubkeyProfileNetwork } from '@/lib/profile-batch-coordinator'
import { cn } from '@/lib/utils'
import { useNoteFeedProfileContext } from '@/providers/NoteFeedProfileContext'
import { useNostr } from '@/providers/NostrProvider'
import client, { replaceableEventService } from '@/services/client.service'
import type { TProfile } from '@/types'
import { kinds, type Event } from 'nostr-tools'
import { Coins } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ZapDialog from '../ZapDialog'
import PostPaymentMessagePrompt from '../ZapDialog/PostPaymentMessagePrompt'
import { mergePostPaymentContext, type PostPaymentContext } from '@/lib/post-payment-context'
import { ZapCountHover } from './NoteStatsCountHover'

type ZapButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<import('@/services/note-stats.service').TNoteStats>
}

function formatAmount(amount: number) {
  if (amount < 1000) return amount
  if (amount < 1000000) return `${Math.round(amount / 100) / 10}k`
  return `${Math.round(amount / 100000) / 10}M`
}

type RecipientResolveResult = {
  profile: TProfile | null
  profileEvent: Event | undefined
  paymentInfo: ReturnType<typeof getPaymentInfoFromEvent> | null
}

const recipientResolveByPubkey = new Map<string, Promise<RecipientResolveResult>>()

function feedProfileRowSyncKey(
  profile: TProfile | undefined | null,
  pendingInFeed: boolean
): string {
  if (!profile) return pendingInFeed ? 'p:wait' : 'p:none'
  return [
    profile.batchPlaceholder ? 'ph' : 'ok',
    profile.username ?? '',
    profile.avatar ?? '',
    profile.npub ?? ''
  ].join('\x1e')
}

async function resolveRecipientPaymentData(
  authorPubkey: string,
  feedProfile: TProfile | undefined | null
): Promise<RecipientResolveResult> {
  const pk = authorPubkey.toLowerCase()
  const inFlight = recipientResolveByPubkey.get(pk)
  if (inFlight) return inFlight

  const run = resolveRecipientPaymentDataBody(pk, feedProfile).finally(() => {
    if (recipientResolveByPubkey.get(pk) === run) {
      recipientResolveByPubkey.delete(pk)
    }
  })
  recipientResolveByPubkey.set(pk, run)
  return run
}

async function resolveRecipientPaymentDataBody(
  authorPubkey: string,
  feedProfile: TProfile | undefined | null
): Promise<RecipientResolveResult> {
  const cachedFeed =
    feedProfile && !feedProfile.batchPlaceholder ? feedProfile : null
  const deferNetwork = shouldDeferPerPubkeyProfileNetwork(authorPubkey)

  if (cachedFeed) {
    const paymentEvent = deferNetwork
      ? await replaceableEventService.getPaymentInfoFromIndexedDB(authorPubkey).catch(() => undefined)
      : await client.fetchPaymentInfoEvent(authorPubkey).catch(() => undefined)
    return {
      profile: cachedFeed,
      profileEvent: undefined,
      paymentInfo: paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null
    }
  }

  const idbProfile = await replaceableEventService.getProfileFromIndexedDB(authorPubkey)

  if (deferNetwork) {
    const paymentEvent = await replaceableEventService
      .getPaymentInfoFromIndexedDB(authorPubkey)
      .catch(() => undefined)
    return {
      profile: idbProfile ?? null,
      profileEvent: undefined,
      paymentInfo: paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null
    }
  }

  const [profileRes, paymentRes] = await Promise.allSettled([
    replaceableEventService.fetchReplaceableEvent(authorPubkey, kinds.Metadata),
    client.fetchPaymentInfoEvent(authorPubkey)
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

export function ZapButtonWithStats({ event, hideCount = false, noteStats }: ZapButtonProps) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { btcUsd, xmrUsd } = useSatsFiatRates()
  const [openPaymentDialog, setOpenPaymentDialog] = useState(false)
  const statsLoaded = noteStatsHasResolvableCounts(noteStats)
  const { hasZapped, hasMoneroTip, moneroPiconerosTotal, hasPaymentHoverContent, totalTipSats } =
    useMemo(() => {
      const moneroTips = noteStats?.moneroTips ?? []
      const moneroPiconerosTotal = moneroTips.reduce((acc, tip) => acc + tip.amountPiconero, 0)
      return {
        hasZapped: pubkey ? noteStats?.zaps?.some((zap) => zap.pubkey === pubkey) : false,
        hasMoneroTip: moneroPiconerosTotal > 0,
        moneroPiconerosTotal,
        hasPaymentHoverContent:
          (noteStats?.zaps?.length ?? 0) > 0 ||
          (noteStats?.paymentNotifications?.length ?? 0) > 0 ||
          moneroTips.length > 0,
        totalTipSats: displayTotalTipSats(noteStats, { btcUsd, xmrUsd }, event.id)
      }
    }, [noteStats, pubkey, btcUsd, xmrUsd])
  const showTipAmount =
    !hideCount &&
    (statsLoaded || totalTipSats > 0 || hasPaymentHoverContent || moneroPiconerosTotal > 0)
  const tipAmountLabel = formatAmount(totalTipSats)
  const authorPubkey = event.pubkey.toLowerCase()
  const isSelf = !!pubkey && pubkey.toLowerCase() === authorPubkey
  const feedProfiles = useNoteFeedProfileContext()
  const feedProfile = feedProfiles?.profiles.get(authorPubkey)
  const feedProfileRef = useRef(feedProfile)
  feedProfileRef.current = feedProfile
  const feedProfileSyncKey = feedProfileRowSyncKey(
    feedProfile,
    Boolean(feedProfiles?.pendingPubkeys.has(authorPubkey))
  )

  const [disable, setDisable] = useState(true)
  const [tipPaymentData, setTipPaymentData] = useState<RecipientPaymentData | null>(null)
  const [postPaymentOpen, setPostPaymentOpen] = useState(false)
  const [postPaymentContext, setPostPaymentContext] = useState<PostPaymentContext | null>(null)

  const handlePostPaymentRequest = useCallback(
    (context: PostPaymentContext) => {
      if (event.pubkey === pubkey) return
      setPostPaymentContext(
        mergePostPaymentContext({ recipientPubkey: event.pubkey, referencedEvent: event }, context)
      )
      setPostPaymentOpen(true)
    },
    [event, pubkey]
  )

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
        mergeRecipientPaymentData(
          buildRecipientPaymentData(paymentInfo, profile, profileEvent ?? null),
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
  }, [isSelf, feedProfile, feedProfileSyncKey, applyTipAvailability])

  useEffect(() => {
    if (isSelf) {
      setDisable(true)
      setTipPaymentData(null)
      return
    }

    setDisable(true)
    setTipPaymentData(null)
    let cancelled = false

    void resolveRecipientPaymentData(authorPubkey, feedProfileRef.current).then(
      ({ profile, profileEvent, paymentInfo }) => {
        if (cancelled) return
        applyTipAvailability(profile, profileEvent ?? null, paymentInfo)
      }
    )

    return () => {
      cancelled = true
    }
  }, [authorPubkey, isSelf, feedProfileSyncKey, applyTipAvailability])

  const handleOpenPaymentMethods = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (disable) return
    setOpenPaymentDialog(true)
  }

  const zapButtonTitle = disable ? t('Tips') : t('Leave a tip')

  return (
    <>
      <div className="flex h-full min-w-0 shrink-0 select-none items-center">
        <button
          type="button"
          className={cn(
            'group flex h-full items-center px-2 touch-manipulation',
            disable ? 'cursor-not-allowed' : 'cursor-pointer'
          )}
          title={zapButtonTitle}
          aria-label={zapButtonTitle}
          disabled={disable}
          onClick={handleOpenPaymentMethods}
        >
          <Coins
            className={cn(
              disable
                ? 'text-muted-foreground/40'
                : cn(
                    'text-muted-foreground group-hover:text-yellow-400',
                    (hasZapped || hasMoneroTip) && 'text-yellow-400'
                  )
            )}
          />
        </button>
        {showTipAmount ? (
          <ZapCountHover noteStats={noteStats}>
            <div
              className={cn(
                'pr-1 text-sm tabular-nums',
                hasZapped || hasMoneroTip ? 'text-yellow-400' : 'text-muted-foreground'
              )}
            >
              {tipAmountLabel} {t('sats')}
            </div>
          </ZapCountHover>
        ) : (
          <span className="pr-1" aria-hidden />
        )}
      </div>
      <ZapDialog
        open={openPaymentDialog}
        setOpen={setOpenPaymentDialog}
        pubkey={event.pubkey}
        event={event}
        prefetchedPayment={tipPaymentData}
        onPostPaymentRequest={handlePostPaymentRequest}
      />
      <PostPaymentMessagePrompt
        open={postPaymentOpen}
        onOpenChange={setPostPaymentOpen}
        recipientPubkey={event.pubkey}
        paymentContext={postPaymentContext}
      />
    </>
  )
}

export default function ZapButton({ event, hideCount = false }: ZapButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  return <ZapButtonWithStats event={event} hideCount={hideCount} noteStats={noteStats} />
}
