import FollowButton from '@/components/FollowButton'
import Nip05 from '@/components/Nip05'
import Nip05List from '@/components/Nip05List'
import NpubQrCode from '@/components/NpubQrCode'
import ProfileAbout from '@/components/ProfileAbout'
import ProfileBanner from '@/components/ProfileBanner'
import { ProfileBotBadge } from '@/components/ProfileBotBadge'
import ProfileOptions from '@/components/ProfileOptions'
import ProfileZapButton from '@/components/ProfileZapButton'
import PubkeyCopy from '@/components/PubkeyCopy'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFetchProfile } from '@/hooks'
import { kinds, type NostrEvent } from 'nostr-tools'
import { createReactionDraftEvent } from '@/lib/draft-event'
import { getPaymentInfoFromEvent } from '@/lib/event-metadata'
import { showSimplePublishSuccess, toastPublishPromise } from '@/lib/publishing-feedback'
import { getNostrArchivesProfileUrl, openExternalUrl, toProfileEditor } from '@/lib/link'
import { encodeProfileInteractionsSpellId } from '@/pages/primary/SpellsPage/fauxSpellConfig'
import { generateImageByPubkey } from '@/lib/pubkey'
import { isVideo, normalizeAnyRelayUrl } from '@/lib/url'
import { usePrimaryPage } from '@/contexts/primary-page-context'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { replaceableEventService } from '@/services/client.service'
import { ReplaceableEventService } from '@/services/client-replaceable-events.service'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Ellipsis,
  ExternalLink,
  Calendar,
  Flag,
  MapPin,
  Pencil,
  SatelliteDish,
  Code,
  Gift,
  Link,
  MessageCircle,
  Network,
  ThumbsUp
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type Ref
} from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'
import NotFound from '../NotFound'
import ProfileBadges from './ProfileBadges'
import ProfileFeed from './ProfileFeed'
import ProfileReportsDialog from './ProfileReportsDialog'
import SmartFollowings from './SmartFollowings'
import SmartMuteLink from './SmartMuteLink'
import SmartRelays from './SmartRelays'
import ZapDialog from '@/components/ZapDialog'
import PostEditor from '@/components/PostEditor'
import {
  ScheduleVideoCallDialog,
  ScheduleInPersonMeetingDialog
} from '@/components/ScheduleVideoCallDialog'
import RawEventDialog from '@/components/NoteOptions/RawEventDialog'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import { FAST_READ_RELAY_URLS, FAST_WRITE_RELAY_URLS } from '@/constants'
import { nip66Service } from '@/services/nip66.service'
import PaymentMethodsSection from '@/components/PaymentMethodsSection'
import { buildRecipientZapPaymentData } from '@/hooks/useRecipientAlternativePayments'
import {
  groupPaymentMethodsByDisplayType,
  mergePaymentMethods,
  recipientHasAnyPaymentOptions,
  sortMergedPaymentMethods
} from '@/lib/merge-payment-methods'
import { PRIMARY_LINK_HOVER_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'

export default function Profile({
  id,
  feedRef,
  alexandriaNotFoundHref = null
}: {
  id?: string
  /** When set, exposes {@link ProfileFeed} `refresh` for titlebars / parent pages. */
  feedRef?: Ref<{ refresh: () => void }>
  /** When profile lookup fails, link to Alexandria with the same identifier (search / deep link). */
  alexandriaNotFoundHref?: string | null
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { navigate: navigatePrimary } = usePrimaryPage()
  const internalFeedRef = useRef<{ refresh: () => void }>(null)
  const profileFeedRef = feedRef ?? internalFeedRef
  const profilePubkeyRef = useRef<string | null>(null)
  const [openReportsDialog, setOpenReportsDialog] = useState(false)

  const { profile, isFetching } = useFetchProfile(id)
  profilePubkeyRef.current = profile?.pubkey ?? null
  const { pubkey: accountPubkey, profileEvent: accountProfileEvent, publish, checkLogin } = useNostr()
  const [paymentInfo, setPaymentInfo] = useState<ReturnType<typeof getPaymentInfoFromEvent> | null>(null)
  const [profileEvent, setProfileEvent] = useState<NostrEvent | undefined>(undefined)
  const [openZapDialog, setOpenZapDialog] = useState(false)
  const [zapLightningDefault, setZapLightningDefault] = useState<string | null>(null)
  const [openPublicMessageTo, setOpenPublicMessageTo] = useState<string | null>(null)
  const [openCallInviteTo, setOpenCallInviteTo] = useState<{ pubkey: string; url: string } | null>(null)
  const [openScheduleOwnCall, setOpenScheduleOwnCall] = useState(false)
  const [openScheduleInPersonMeeting, setOpenScheduleInPersonMeeting] = useState(false)
  const [isRawEventDialogOpen, setIsRawEventDialogOpen] = useState(false)
  const [openSelfReply, setOpenSelfReply] = useState(false)
  const [selfReacting, setSelfReacting] = useState(false)
  const { relayUrls: currentBrowsingRelayUrls } = useCurrentRelays()
  const { relaySets, favoriteRelays } = useFavoriteRelays()

  const isSelf = accountPubkey === profile?.pubkey

  const effectiveProfileEvent = useMemo(() => {
    if (!isSelf || !accountProfileEvent) return profileEvent
    if (!profileEvent) return accountProfileEvent
    return accountProfileEvent.created_at >= profileEvent.created_at ? accountProfileEvent : profileEvent
  }, [isSelf, profileEvent, accountProfileEvent])

  const mergedPaymentMethods = useMemo(
    () =>
      sortMergedPaymentMethods(
        mergePaymentMethods(paymentInfo, profile ?? null, effectiveProfileEvent)
      ),
    [paymentInfo, profile, effectiveProfileEvent]
  )

  const paymentMethodsByType = useMemo(
    () => groupPaymentMethodsByDisplayType(mergedPaymentMethods),
    [mergedPaymentMethods]
  )

  const hasTipDialog = useMemo(
    () => recipientHasAnyPaymentOptions(paymentInfo, profile ?? null, effectiveProfileEvent),
    [paymentInfo, profile, effectiveProfileEvent]
  )

  const prefetchedZapPayment = useMemo(
    () =>
      profile?.pubkey
        ? buildRecipientZapPaymentData(paymentInfo, profile ?? null, effectiveProfileEvent ?? null)
        : null,
    [paymentInfo, profile, effectiveProfileEvent]
  )

  const syncAuthorReplaceablesFromCache = useCallback(
    async (pubkey: string, options?: { bustCache?: boolean }) => {
      try {
        if (options?.bustCache) {
          replaceableEventService.clearAuthorViewPaymentAndMetadataLoaders(pubkey)
        }
        const [paymentEvent, metaEvent] = await Promise.all([
          client.fetchPaymentInfoEvent(pubkey),
          replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata)
        ])
        setPaymentInfo(paymentEvent ? getPaymentInfoFromEvent(paymentEvent) : null)
        setProfileEvent(metaEvent ?? undefined)
      } catch (error) {
        logger.error('Failed to sync author replaceables from cache', { error, pubkey })
      }
    },
    []
  )

  useEffect(() => {
    if (!profile?.pubkey) {
      setPaymentInfo(null)
      setProfileEvent(undefined)
      return
    }
    void syncAuthorReplaceablesFromCache(profile.pubkey)
  }, [profile?.pubkey, syncAuthorReplaceablesFromCache])

  const refreshAuthorReplaceables = useCallback(async (pubkey: string) => {
    await client.forceRefreshProfileAndPaymentInfoCache(pubkey)
    await syncAuthorReplaceablesFromCache(pubkey)
  }, [syncAuthorReplaceablesFromCache])

  useEffect(() => {
    if (!profile?.pubkey || profile.batchPlaceholder) return
    const pk = profile.pubkey
    // Defer wide replaceable refresh so initial kind-0 / feed relay setup can finish first.
    const timer = window.setTimeout(() => {
      void client.refreshAuthorPublishedReplaceablesOnProfileView(pk)
    }, 2_000)
    return () => clearTimeout(timer)
  }, [profile?.pubkey, profile?.batchPlaceholder])

  useEffect(() => {
    if (!isSelf || !profile?.pubkey || !accountProfileEvent) return
    setProfileEvent((prev) =>
      !prev || accountProfileEvent.created_at >= prev.created_at ? accountProfileEvent : prev
    )
    void syncAuthorReplaceablesFromCache(profile.pubkey, { bustCache: true })
  }, [isSelf, accountProfileEvent, profile?.pubkey, syncAuthorReplaceablesFromCache])

  useEffect(() => {
    if (!profile?.pubkey) return
    const pk = profile.pubkey.toLowerCase()
    const onAuthorReplaceablesRefreshed: EventListener = (domEvt) => {
      const detailPk = (domEvt as CustomEvent<{ pubkey?: string }>).detail?.pubkey?.toLowerCase()
      if (detailPk !== pk) return
      void syncAuthorReplaceablesFromCache(profile.pubkey)
    }
    window.addEventListener(
      ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT,
      onAuthorReplaceablesRefreshed
    )
    return () =>
      window.removeEventListener(
        ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT,
        onAuthorReplaceablesRefreshed
      )
  }, [profile?.pubkey, syncAuthorReplaceablesFromCache])

  const defaultImage = useMemo(
    () => (profile?.pubkey ? generateImageByPubkey(profile?.pubkey) : ''),
    [profile]
  )
  /** All available relays: current feed, favorites, relay sets, defaults (FAST_READ, FAST_WRITE). */
  const allAvailableRelayUrls = useMemo(() => {
    const urls = [
      ...currentBrowsingRelayUrls.map(url => normalizeAnyRelayUrl(url) || url),
      ...favoriteRelays.map(url => normalizeAnyRelayUrl(url) || url),
      ...relaySets.flatMap(set => set.relayUrls.map(url => normalizeAnyRelayUrl(url) || url)),
      ...FAST_READ_RELAY_URLS.map(url => normalizeAnyRelayUrl(url) || url),
      ...FAST_WRITE_RELAY_URLS.map(url => normalizeAnyRelayUrl(url) || url)
    ].filter(Boolean) as string[]
    return Array.from(new Set(urls))
  }, [currentBrowsingRelayUrls, favoriteRelays, relaySets])

  const handleRepublishToAllAvailable = async () => {
    if (!profileEvent) return
    const promise = client.publishEvent(allAvailableRelayUrls, profileEvent, { skipOutboxRetry: true }).then((result) => {
      if (result.successCount < 1) {
        throw new Error(t('No relay accepted the event'))
      }
      return result
    })
    toastPublishPromise(promise, {
      loading: t('Republishing...'),
      success: () => t('Successfully republish to all available relays'),
      error: (err) => t('Failed to republish to all available relays: {{error}}', { error: err.message })
    })
  }

  const handleRepublishToAllActive = async () => {
    if (!profileEvent) return
    const promise = (async () => {
      let relays = await nip66Service.getPublicLivelyRelayUrls()
      const usedMonitoringList = !!relays?.length
      if (!relays?.length) {
        relays = allAvailableRelayUrls
      }
      if (!relays?.length) {
        throw new Error(t('No relays available'))
      }
      const result = await client.publishEvent(relays, profileEvent, { skipOutboxRetry: true })
      const minRequired = usedMonitoringList ? 5 : 1
      if (result.successCount < minRequired) {
        throw new Error(
          usedMonitoringList
            ? t('Only {{count}} relay(s) accepted the event; at least 5 required for "all active relays".', { count: result.successCount })
            : t('No relay accepted the event')
        )
      }
      return result
    })()
    toastPublishPromise(promise, {
      loading: t('Republishing...'),
      success: () => t('Successfully republish to all active relays'),
      error: (err) => t('Failed to republish to all active relays: {{error}}', { error: err.message })
    })
  }

  useLayoutEffect(() => {
    const r = profileFeedRef
    if (typeof r === 'function') return
    const m = r as MutableRefObject<{ refresh: () => void } | null>
    m.current = {
      refresh: () => {
        internalFeedRef.current?.refresh()
        const pk = profilePubkeyRef.current
        if (pk) {
          void refreshAuthorReplaceables(pk)
        }
      }
    }
    return () => {
      m.current = null
    }
  }, [refreshAuthorReplaceables])

  if (!profile && isFetching) {
    return (
      <>
        <div>
          <div className="relative isolate mb-2 bg-cover bg-center">
            <Skeleton className="relative z-0 w-full aspect-[3/1] rounded-none" />
            <Skeleton className="absolute bottom-0 left-3 z-20 h-24 w-24 translate-y-1/2 rounded-full border-4 border-background md:h-48 md:w-48" />
          </div>
        </div>
        <div className="px-4">
          <Skeleton className="h-5 w-28 mt-14 md:mt-28 mb-1 md:ml-56" />
          <Skeleton className="h-5 w-56 mt-2 my-1 rounded-full md:ml-56" />
        </div>
        <div className="px-4 pt-4 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">
            {t('Searching all available relays...')}
          </div>
        </div>
      </>
    )
  }
  if (!profile && !isFetching) {
    return (
      <NotFound>
        {alexandriaNotFoundHref ? <AlexandriaEventsSearchEmptyCta href={alexandriaNotFoundHref} /> : null}
      </NotFound>
    )
  }
  
  if (!profile) return null // TypeScript guard - should never reach here but satisfies type checker

  const { banner, username, about, avatar, pubkey, website, websiteList, nip05List, isBot } = profile
  const nostrArchivesProfileUrl = getNostrArchivesProfileUrl(pubkey)

  return (
    <>
      <div>
        <div className="relative isolate mb-2 bg-cover bg-center">
          {/* Banner first in paint order; avatar uses higher z-index so it always sits on top. fetchPriority still prefers the pic over the banner. */}
          <ProfileBanner
            banner={banner}
            pubkey={pubkey}
            className="relative z-0 w-full overflow-hidden aspect-[3/1]"
            imageFetchPriority="low"
          />
          {isVideo(avatar ?? '') ? (
            <div className="absolute bottom-0 left-3 z-20 h-24 w-24 translate-y-1/2 md:h-48 md:w-48">
              <div className="relative h-full w-full">
                <div className="h-full w-full overflow-hidden rounded-full border-4 border-background bg-muted">
                  <video
                    src={avatar}
                    className="h-full w-full object-cover object-center"
                    autoPlay
                    muted
                    loop
                    playsInline
                    fetchPriority="high"
                  />
                </div>
                {isBot ? (
                  <ProfileBotBadge size="lg" className="bottom-1 right-1 md:bottom-2 md:right-2" />
                ) : null}
              </div>
            </div>
          ) : (
            <div className="absolute bottom-0 left-3 z-20 h-24 w-24 translate-y-1/2 md:h-48 md:w-48">
              <div className="relative h-full w-full">
                <Avatar className="h-full w-full border-4 border-background">
                  <AvatarImage
                    src={avatar}
                    className="object-cover object-center"
                    fetchPriority="high"
                    loading="eager"
                  />
                  <AvatarFallback>
                    <img src={defaultImage} alt="" />
                  </AvatarFallback>
                </Avatar>
                {isBot ? (
                  <ProfileBotBadge size="lg" className="bottom-1 right-1 md:bottom-2 md:right-2" />
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="px-4">
          <div className="flex flex-wrap justify-end gap-2 items-center min-w-0">
            <ProfileOptions
              pubkey={pubkey}
              profileEvent={effectiveProfileEvent}
              onSendPublicMessage={!isSelf ? () => setOpenPublicMessageTo(pubkey) : undefined}
              onSendCallInvite={
                !isSelf
                  ? (url) => setOpenCallInviteTo({ pubkey, url })
                  : undefined
              }
              onSeeReports={() => setOpenReportsDialog(true)}
            />
            {isSelf ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" className="rounded-full">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {profileEvent && (
                    <>
                      <DropdownMenuItem onClick={() => setOpenSelfReply(true)}>
                        <MessageCircle />
                        {t('Reply')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (!profileEvent) return
                          checkLogin(async () => {
                            if (selfReacting) return
                            setSelfReacting(true)
                            try {
                              const reaction = createReactionDraftEvent(profileEvent, '+')
                              const evt = await publish(reaction)
                              if (evt) {
                                showSimplePublishSuccess(t('Reaction published'))
                              }
                            } finally {
                              setSelfReacting(false)
                            }
                          })
                        }}
                        disabled={selfReacting}
                      >
                        <ThumbsUp />
                        {selfReacting ? t('Publishing...') : t('Like')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setOpenScheduleOwnCall(true)}>
                    <Calendar />
                    {t('Schedule a video call')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenScheduleInPersonMeeting(true)}>
                    <MapPin />
                    {t('Schedule in-person meeting')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigatePrimary('spells', { spell: 'followPacks' })}>
                    <Gift />
                    {t('Follow Packs')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => navigatePrimary('spells', { spell: encodeProfileInteractionsSpellId(pubkey) })}
                  >
                    <Network />
                    {t('Interactions map')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOpenReportsDialog(true)}>
                    <Flag />
                    {t('See reports')}
                  </DropdownMenuItem>
                  {nostrArchivesProfileUrl ? (
                    <DropdownMenuItem onClick={() => openExternalUrl(nostrArchivesProfileUrl)}>
                      <ExternalLink />
                      {t('View on Nostr.Archives')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => push(toProfileEditor())}>
                    <Pencil />
                    {t('Edit')}
                  </DropdownMenuItem>
                  {profileEvent && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleRepublishToAllAvailable}>
                        <SatelliteDish />
                        {t('Republish to all available relays')} ({allAvailableRelayUrls.length})
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleRepublishToAllActive}>
                        <SatelliteDish />
                        {t('Republish to all active relays')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setIsRawEventDialogOpen(true)}>
                        <Code />
                        {t('View JSON')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {profileEvent && isSelf && (
              <PostEditor
                parentEvent={profileEvent}
                open={openSelfReply}
                setOpen={setOpenSelfReply}
              />
            )}
            {!isSelf ? (
              <>
                {hasTipDialog && (
                  <ProfileZapButton
                    pubkey={pubkey}
                    openZapDialog={openZapDialog}
                    setOpenZapDialog={(open) => {
                      if (open) setZapLightningDefault(null)
                      setOpenZapDialog(open)
                      if (!open) setZapLightningDefault(null)
                    }}
                  />
                )}
                <FollowButton pubkey={pubkey} />
              </>
            ) : null}
          </div>
          <div className="pt-2 pb-4 md:pl-56">
            <div className="flex flex-wrap gap-2 items-center min-w-0">
              <div className="text-xl font-semibold truncate select-text max-w-full">{username}</div>
            </div>
            <Nip05 pubkey={pubkey} nip05={profile.nip05} />
            {/* Display multiple NIP-05 values if available, with verification */}
            {nip05List && nip05List.length > 1 && (
              <Nip05List nip05List={nip05List.slice(1)} pubkey={pubkey} />
            )}
            <div className="flex flex-wrap gap-1 mt-1 min-w-0">
              <PubkeyCopy pubkey={pubkey} showFull />
              <NpubQrCode pubkey={pubkey} />
            </div>
            <ProfileAbout
              about={about}
              className="text-wrap break-words whitespace-pre-wrap mt-2 select-text"
            />
            {/* Display websites - show first one prominently, others below */}
            {website && (
              <div className="group flex gap-1 items-center mt-2 truncate select-text">
                <Link
                  size={14}
                  className={cn('shrink-0 text-primary transition-colors', 'group-hover:text-foreground')}
                />
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(PRIMARY_LINK_HOVER_CLASS, 'truncate flex-1 max-w-fit w-0')}
                >
                  {website}
                </a>
              </div>
            )}
            {websiteList && websiteList.length > 1 && (
              <div className="flex flex-col gap-1 mt-1">
                {websiteList.slice(1).map((url: string, idx: number) => (
                  <div
                    key={idx}
                    className="group flex gap-1 items-center truncate select-text"
                  >
                    <Link
                      size={12}
                      className={cn(
                        'shrink-0 text-primary transition-colors',
                        'group-hover:text-foreground'
                      )}
                    />
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(PRIMARY_LINK_HOVER_CLASS, 'truncate text-sm')}
                    >
                      {url}
                    </a>
                  </div>
                ))}
              </div>
            )}
            {paymentMethodsByType.length > 0 && (
              <PaymentMethodsSection
                groups={paymentMethodsByType}
                recipientPubkey={pubkey}
                onOpenZap={(lightningAuthority) => {
                  setZapLightningDefault(lightningAuthority)
                  setOpenZapDialog(true)
                }}
                className="mt-2 mb-4 p-3 pb-4 border rounded-lg bg-muted/50 min-w-0"
              />
            )}
            <ZapDialog
              open={openZapDialog}
              setOpen={(next) => {
                const willOpen = typeof next === 'function' ? next(openZapDialog) : next
                setOpenZapDialog(willOpen)
                if (!willOpen) setZapLightningDefault(null)
              }}
              pubkey={pubkey}
              defaultLightningAddress={zapLightningDefault}
              prefetchedPayment={prefetchedZapPayment}
            />
            <div className="flex flex-wrap gap-4 items-center gap-x-4 gap-y-2 mt-2 text-sm min-w-0">
              <SmartFollowings pubkey={pubkey} />
              <SmartRelays pubkey={pubkey} />
              {isSelf && <SmartMuteLink />}
            </div>
            <ProfileBadges pubkey={pubkey} profileEventId={effectiveProfileEvent?.id} />
          </div>
        </div>
      </div>
      <ProfileFeed ref={profileFeedRef} pubkey={pubkey} />
      <ProfileReportsDialog
        open={openReportsDialog}
        onOpenChange={setOpenReportsDialog}
        pubkey={pubkey}
      />
      {openPublicMessageTo && (
        <PostEditor
          open={!!openPublicMessageTo}
          setOpen={(open) => !open && setOpenPublicMessageTo(null)}
          initialPublicMessageTo={openPublicMessageTo}
        />
      )}
      {openCallInviteTo && (
        <PostEditor
          open={!!openCallInviteTo}
          setOpen={(open) => !open && setOpenCallInviteTo(null)}
          initialPublicMessageTo={openCallInviteTo.pubkey}
          defaultContent={`${t('Join the video call')}: ${openCallInviteTo.url}`}
        />
      )}
      <ScheduleVideoCallDialog
        open={openScheduleOwnCall}
        onOpenChange={setOpenScheduleOwnCall}
      />
      <ScheduleInPersonMeetingDialog
        open={openScheduleInPersonMeeting}
        onOpenChange={setOpenScheduleInPersonMeeting}
      />
      {profileEvent && (
        <RawEventDialog
          event={profileEvent}
          isOpen={isRawEventDialogOpen}
          onClose={() => setIsRawEventDialogOpen(false)}
        />
      )}
    </>
  )
}
