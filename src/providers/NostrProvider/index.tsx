import { APP_RESET_TO_LANDING_EVENT } from '@/constants'
import storage from '@/services/local-storage.service'
import LoginDialog from '@/components/LoginDialog'
import NcryptsecPasswordPrompt from '@/components/NcryptsecPasswordPrompt'
import {
  ACCOUNT_SESSION_HYDRATE_WALL_MS,
  ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS,
  DEFAULT_FAVORITE_RELAYS,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  AUTHOR_PROFILE_VIEW_REPLACEABLE_KINDS,
  ExtendedKind,
  PROFILE_RELAY_URLS,
  SEARCHABLE_RELAY_URLS,
  UNSIGNED_EXPERIMENTAL_KIND_MAX,
  UNSIGNED_EXPERIMENTAL_KIND_MIN,
  isUnsignedExperimentalKind
} from '@/constants'
import {
  applyImwaldAttributionTags,
  createDeletionRequestDraftEvent
} from '@/lib/draft-event'
import {
  TNewUserTemplateDrafts,
  buildNewUserTemplateDrafts
} from '@/lib/new-user-template'
import { markNewUserTemplateBroadcastPending } from '@/lib/new-user-template-broadcast'
import {
  clearFreshSignupSkipNetworkHydrate,
  markFreshSignupSkipNetworkHydrate,
  schedulePostSignupBackupPrompt,
  shouldSkipNetworkHydrateForFreshSignup
} from '@/lib/post-signup-backup-prompt'
import { getLatestEvent, minePow } from '@/lib/event'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import {
  getHttpRelayListFromEvent,
  getProfileFromEvent,
  getRelayListFromEvent,
  mergeHydratedCacheRelayListEvents,
  mergeHydratedHttpRelayListEvents
} from '@/lib/event-metadata'
import logger from '@/lib/logger'
import { bindLightArchiveCacheRelayUrls } from '@/lib/note-persistence-policy'
import { buildAccountSessionNetworkHydrateRelayUrls } from '@/lib/relay-list-builder'
import {
  fetchViewerListReplaceablesFromWriteOutboxes,
  pickNewestListEvent
} from '@/lib/viewer-list-replaceable-fetch'
import { getCacheRelayUrlsFromEvent } from '@/lib/private-relays'
import { viewerUsesGlobalRelayDefaults } from '@/lib/viewer-relay-defaults'
import {
  parseBlockedRelayUrlsFromEvent,
  setViewerBlockedRelayUrls
} from '@/lib/viewer-blocked-relays'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { normalizeAnyRelayUrl, normalizeUrl } from '@/lib/url'
import {
  accountPubkeyToHex,
  formatPubkey,
  hexPubkeysEqual,
  isValidPubkey,
  normalizeHexPubkey,
  pubkeyToNpub,
  pubkeyFromNip07Extension
} from '@/lib/pubkey'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import client from '@/services/client.service'
import { ReplaceableEventService } from '@/services/client-replaceable-events.service'
import { queryService, replaceableEventService } from '@/services/client.service'
import customEmojiService from '@/services/custom-emoji.service'
import indexedDb from '@/services/indexed-db.service'
import postEditorCache from '@/services/post-editor-cache.service'
import postEditorService from '@/services/post-editor.service'
import noteStatsService from '@/services/note-stats.service'
import {
  ISigner,
  TAccount,
  TAccountPointer,
  TDraftEvent,
  TProfile,
  TPublishOptions,
  TRelayList,
  TMailboxRelay
} from '@/types'
import { hexToBytes } from '@noble/hashes/utils'
import dayjs from 'dayjs'
import { Event, kinds, VerifiedEvent, getEventHash, validateEvent } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import { NostrContext, type TNostrContext } from '@/providers/nostr-context'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEventCallback } from '@/hooks/use-event-callback'
import { useTranslation } from 'react-i18next'
import { findStoredAccountForPointer, isSameAccount, canAccountSignEvents, canManageIdentityFeatures } from '@/lib/account'
import {
  createAnonAccountPointer,
  createEphemeralSigner,
  isAnonAccount,
  isAnonSessionPersisted,
  setAnonSessionPersisted
} from '@/lib/anon-session'
import { flushSync } from 'react-dom'
import { toast } from 'sonner'
import { BunkerSigner } from './bunker.signer'
import { Nip07Signer } from './nip-07.signer'
import { NostrConnectionSigner } from './nostrConnection.signer'
import { NpubSigner } from './npub.signer'
import { NsecSigner } from './nsec.signer'

export { useNostr } from '@/providers/nostr-context'
export type { TNostrContext } from '@/providers/nostr-context'

/** One session-restore pass per full page load (React StrictMode remount must not re-login). */
let nostrSessionRestoreStarted = false

const VIEWER_INTEREST_LIST_KIND = 10015

/** Kind 10012 `relay` tags for publish / target-relay prioritization. */
function favoriteRelayUrlsForPublish(
  favoriteRelaysEvent: Event | null,
  pubkey: string | null,
  relayList: TRelayList | null | undefined,
  account: TAccountPointer | null
): string[] {
  if (isAnonAccount(account)) return [...FAST_WRITE_RELAY_URLS]
  const urlsFromEvent = (): string[] => {
    const urls: string[] = []
    if (!favoriteRelaysEvent) return urls
    favoriteRelaysEvent.tags.forEach(([name, v]) => {
      if (name === 'relay' && v) {
        const n = normalizeAnyRelayUrl(v) || v
        if (n && !urls.includes(n)) urls.push(n)
      }
    })
    return urls
  }
  const fromEvent = urlsFromEvent()
  const useGlobal = viewerUsesGlobalRelayDefaults({
    viewerPubkey: pubkey,
    favoriteRelayUrls: fromEvent,
    relayList
  })
  if (!favoriteRelaysEvent) {
    return useGlobal && pubkey ? [...DEFAULT_FAVORITE_RELAYS] : []
  }
  if (fromEvent.length > 0) return fromEvent
  return useGlobal && pubkey ? [...DEFAULT_FAVORITE_RELAYS] : []
}

function blockedRelayUrlsFromEvent(blockedRelaysEvent: Event | null): string[] {
  return parseBlockedRelayUrlsFromEvent(blockedRelaysEvent)
}

const NIP07_SIGNER_PUBKEY_MISMATCH_MSG = 'Signer pubkey does not match current account'

function isNip07SignerPubkeyMismatchError(e: unknown): boolean {
  return e instanceof Error && e.message === NIP07_SIGNER_PUBKEY_MISMATCH_MSG
}

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<TAccountPointer[]>(
    storage.getAccounts().map((act) => ({ pubkey: act.pubkey, signerType: act.signerType }))
  )
  const [account, setAccount] = useState<TAccountPointer | null>(null)
  const [nsec, setNsec] = useState<string | null>(null)
  const [ncryptsec, setNcryptsec] = useState<string | null>(null)
  const [signer, setSigner] = useState<ISigner | null>(null)
  const [openLoginDialog, setOpenLoginDialog] = useState(false)
  const [isNip07LoginInFlight, setIsNip07LoginInFlight] = useState(false)
  const nip07LoginInFlightRef = useRef(false)
  const [ncryptsecPasswordOpen, setNcryptsecPasswordOpen] = useState(false)
  const ncryptsecPasswordResolveRef = useRef<((value: string | null) => void) | null>(null)
  /** One toast per mismatch episode; cleared after a successful NIP-07 login. */
  /**
   * User picked a stored NIP-07 account from the notifications switcher but the extension key
   * differs — we fall back to read-only npub without spamming the mismatch toast / recovery UI.
   */
  const intentionalNip07ReadOnlyPubkeyRef = useRef<string | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)

  const [profileEvent, setProfileEvent] = useState<Event | null>(null)
  const [relayList, setRelayList] = useState<TRelayList | null>(null)
  const [cacheRelayListEvent, setCacheRelayListEvent] = useState<Event | null>(null)
  const [cacheRelaysEnabled, setCacheRelaysEnabledState] = useState(() => storage.getCacheRelaysEnabled())
  useEffect(() => {
    bindLightArchiveCacheRelayUrls(
      cacheRelaysEnabled ? getCacheRelayUrlsFromEvent(cacheRelayListEvent) : []
    )
    void client.applyNotePersistencePolicyChange()
  }, [cacheRelayListEvent, cacheRelaysEnabled])
  const [httpRelayListEvent, setHttpRelayListEvent] = useState<Event | null | undefined>(undefined)
  const [followListEvent, setFollowListEvent] = useState<Event | null>(null)
  const [muteListEvent, setMuteListEvent] = useState<Event | null>(null)
  const [bookmarkListEvent, setBookmarkListEvent] = useState<Event | null>(null)
  const [interestListEvent, setInterestListEvent] = useState<Event | null>(null)
  const [favoriteRelaysEvent, setFavoriteRelaysEvent] = useState<Event | null>(null)
  const [blockedRelaysEvent, setBlockedRelaysEvent] = useState<Event | null>(null)
  const [userEmojiListEvent, setUserEmojiListEvent] = useState<Event | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isAccountSessionHydrating, setIsAccountSessionHydrating] = useState(false)
  /** Bumps on each account hydration run so stale async completions cannot clear {@link isAccountSessionHydrating}. */
  const accountHydrationGenerationRef = useRef(0)
  /** When true, next hydrate run performs a full network merge without clearing UI state from IndexedDB first. */
  const forceNextAccountNetworkHydrateRef = useRef(false)
  /** Last account pubkey for which we cleared session UI; avoids nulling relay/profile on same-account rehydrate. */
  const lastNetworkHydrateAccountPubkeyRef = useRef<string | null>(null)
  const manualNetworkHydrateResolveRef = useRef<(() => void) | null>(null)
  /** Prevents duplicate new-user sign/publish when login or StrictMode fires twice. */
  const newUserSetupInFlightRef = useRef(new Set<string>())
  const [accountNetworkHydrateBump, setAccountNetworkHydrateBump] = useState(0)
  /**
   * Bumped by {@link switchAccount} after it persists the intended target to storage following
   * an npub fallback. This re-triggers the NIP-07 recovery loop so it can reconnect as soon
   * as the user updates their browser extension.
   */
  const [nip07RecoveryBump, setNip07RecoveryBump] = useState(0)

  const accountForReplaceablesSyncRef = useRef<TAccountPointer | null>(null)
  useEffect(() => {
    accountForReplaceablesSyncRef.current = account
  }, [account])

  /** Re-read all viewer replaceables (relay lists, favorites, etc.) from IndexedDB into React state. */
  const syncViewerAccountReplaceablesFromIndexedDb = useCallback(async (pubkey: string) => {
    const loadOk = async (kind: number) => {
      const e = await indexedDb.getReplaceableEvent(pubkey, kind).catch(() => null)
      return e && !shouldDropEventOnIngest(e) ? e : null
    }
    try {
      const [
        meta,
        contacts,
        mute,
        bookmark,
        fav,
        blocked,
        emoji,
        interest,
        cacheRel,
        httpRel,
        blossom,
        payment
      ] = await Promise.all([
        loadOk(kinds.Metadata),
        loadOk(kinds.Contacts),
        loadOk(kinds.Mutelist),
        loadOk(kinds.BookmarkList),
        loadOk(ExtendedKind.FAVORITE_RELAYS),
        loadOk(ExtendedKind.BLOCKED_RELAYS),
        loadOk(kinds.UserEmojiList),
        loadOk(VIEWER_INTEREST_LIST_KIND),
        loadOk(ExtendedKind.CACHE_RELAYS),
        loadOk(ExtendedKind.HTTP_RELAY_LIST),
        loadOk(ExtendedKind.BLOSSOM_SERVER_LIST),
        loadOk(ExtendedKind.PAYMENT_INFO)
      ])
      if (meta) {
        setProfileEvent(meta)
        setProfile(getProfileFromEvent(meta))
        void replaceableEventService.updateReplaceableEventCache(meta).catch(() => {})
      }
      if (contacts) setFollowListEvent(contacts)
      if (mute) setMuteListEvent(mute)
      if (bookmark) setBookmarkListEvent(bookmark)
      if (fav) setFavoriteRelaysEvent(fav)
      if (blocked) {
        setBlockedRelaysEvent(blocked)
        setViewerBlockedRelayUrls(parseBlockedRelayUrlsFromEvent(blocked))
      }
      if (emoji) setUserEmojiListEvent(emoji)
      if (interest) setInterestListEvent(interest)
      setCacheRelayListEvent((prev) => mergeHydratedCacheRelayListEvents(cacheRel ? [cacheRel] : [], prev))
      setHttpRelayListEvent((prev) => {
        if (prev === undefined) return httpRel ?? null
        return mergeHydratedHttpRelayListEvents(httpRel ? [httpRel] : [], prev) ?? null
      })
      if (blossom) void client.updateBlossomServerListEventCache(blossom)
      if (payment) void replaceableEventService.updateReplaceableEventCache(payment).catch(() => {})
      setRelayList(await client.peekRelayListFromStorage(pubkey))
    } catch (e) {
      logger.warn('[NostrProvider] Failed to sync account replaceables from IndexedDB', { error: e })
    }
  }, [])

  useEffect(() => {
    if (nostrSessionRestoreStarted) return
    nostrSessionRestoreStarted = true
    const init = async () => {
      logger.debug('[NostrProvider] Restoring session (login / first account)…')
      if (hasNostrLoginHash()) {
        return await loginByNostrLoginHash()
      }

      if (isAnonSessionPersisted()) {
        loginAnon()
        return
      }

      const accounts = storage.getAccounts()
      const act = storage.getCurrentAccount() ?? accounts[0] // auto login the first account
      if (!act) return

      await loginWithAccountPointer(act)
    }
    init()
      .then(() => {
        logger.debug('[NostrProvider] Session restore finished; feeds and UI can initialize')
        setIsInitialized(true)
      })
      .catch((e) => {
        logger.error('[NostrProvider] Session restore failed', { error: e })
        setIsInitialized(true)
      })

    const handleHashChange = () => {
      if (hasNostrLoginHash()) {
        loginByNostrLoginHash()
      }
    }

    window.addEventListener('hashchange', handleHashChange)

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  /** Logged-out: run IndexedDB + NIP-66 prewarm once session gate opens (logged-in path includes this inside hydrate). */
  useEffect(() => {
    if (!isInitialized || account) return
    void client.runSessionPrewarm({ pubkey: null })
  }, [isInitialized, account])

  useEffect(() => {
    let hydrationGenForThisRun = -1
    const init = async () => {
      if (!account) {
        accountHydrationGenerationRef.current += 1
        lastNetworkHydrateAccountPubkeyRef.current = null
        setIsAccountSessionHydrating(false)
        forceNextAccountNetworkHydrateRef.current = false
        setRelayList(null)
        setProfile(null)
        setProfileEvent(null)
        setNsec(null)
        setFavoriteRelaysEvent(null)
        setFollowListEvent(null)
        setMuteListEvent(null)
        setBookmarkListEvent(null)
        setCacheRelayListEvent(null)
        setHttpRelayListEvent(undefined)
        return undefined
      }

      if (isAnonAccount(account)) {
        setIsAccountSessionHydrating(false)
        lastNetworkHydrateAccountPubkeyRef.current = null
        return undefined
      }

      const userForcedAccountNetworkHydrate = forceNextAccountNetworkHydrateRef.current
      if (userForcedAccountNetworkHydrate) {
        forceNextAccountNetworkHydrateRef.current = false
      }

      const prevHydratedPk = lastNetworkHydrateAccountPubkeyRef.current
      const switchedToDifferentAccount =
        prevHydratedPk != null && prevHydratedPk !== account.pubkey
      if (switchedToDifferentAccount) {
        setRelayList(null)
        setProfile(null)
        setProfileEvent(null)
        setNsec(null)
        setFavoriteRelaysEvent(null)
        setFollowListEvent(null)
        setMuteListEvent(null)
        setBookmarkListEvent(null)
        setCacheRelayListEvent(null)
        setHttpRelayListEvent(undefined)
      }

      hydrationGenForThisRun = accountHydrationGenerationRef.current += 1
      logger.debug('[NostrProvider] Account session hydrate: loading cache and relays…', {
        pubkeySlice: account.pubkey.slice(0, 12),
        hydrationGen: hydrationGenForThisRun
      })
      const controller = new AbortController()
      /** Abort + bounded time on hydrate REQs so tab close / account switch does not leave hung subs. */
      const hydrateFetchOpts = {
        signal: controller.signal,
        globalTimeout: 14_000,
        eoseTimeout: 4_000,
        foreground: true as const,
        firstRelayResultGraceMs: false as const
      }
      const storedNsec = storage.getAccountNsec(account.pubkey)
      if (storedNsec) {
        setNsec(storedNsec)
      } else {
        setNsec(null)
      }
      const storedNcryptsec = storage.getAccountNcryptsec(account.pubkey)
      if (storedNcryptsec) {
        setNcryptsec(storedNcryptsec)
      } else {
        setNcryptsec(null)
      }

      const INTEREST_LIST_KIND = VIEWER_INTEREST_LIST_KIND

      const [
        storedRelayListEvent,
        storedCacheRelayListEvent,
        storedProfileEvent,
        storedFollowListEvent,
        storedMuteListEvent,
        storedBookmarkListEvent,
        storedFavoriteRelaysEvent,
        storedBlockedRelaysEvent,
        storedUserEmojiListEvent,
        storedInterestListEvent,
        storedBlossomServerListEvent,
        storedHttpRelayListEvent
      ] = await Promise.all([
        indexedDb.getReplaceableEvent(account.pubkey, kinds.RelayList),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.CACHE_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Metadata),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Contacts),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.Mutelist),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.BookmarkList),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.FAVORITE_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.BLOCKED_RELAYS),
        indexedDb.getReplaceableEvent(account.pubkey, kinds.UserEmojiList),
        indexedDb.getReplaceableEvent(account.pubkey, INTEREST_LIST_KIND),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.BLOSSOM_SERVER_LIST),
        indexedDb.getReplaceableEvent(account.pubkey, ExtendedKind.HTTP_RELAY_LIST)
      ])
      
      // Extract blocked relays from event (sync to fetch layer before feed REQs)
      const blockedRelays = parseBlockedRelayUrlsFromEvent(storedBlockedRelaysEvent ?? null)
      setViewerBlockedRelayUrls(blockedRelays)
      if (storedBlockedRelaysEvent && !userForcedAccountNetworkHydrate) {
        setBlockedRelaysEvent(storedBlockedRelaysEvent)
      }
      
      // Set initial relay list from stored events (will be updated with merged list later)
      // Merge cache relays even at initial load so cache relays are available immediately
      if (
        !userForcedAccountNetworkHydrate &&
        (storedRelayListEvent || storedCacheRelayListEvent || storedHttpRelayListEvent)
      ) {
        const emptyHttp = {
          httpRead: [] as string[],
          httpWrite: [] as string[],
          httpOriginalRelays: [] as TMailboxRelay[]
        }
        let baseRelayList: TRelayList = storedRelayListEvent
          ? getRelayListFromEvent(storedRelayListEvent, blockedRelays)
          : { write: [], read: [], originalRelays: [], ...emptyHttp }
        const httpSlice = getHttpRelayListFromEvent(storedHttpRelayListEvent, blockedRelays)
        baseRelayList = {
          ...baseRelayList,
          httpRead: httpSlice.httpRead,
          httpWrite: httpSlice.httpWrite,
          httpOriginalRelays: httpSlice.httpOriginalRelays
        }

        if (storedCacheRelayListEvent && storage.getCacheRelaysEnabled()) {
          const cacheRelayList = getRelayListFromEvent(storedCacheRelayListEvent)

          const mergedRead = [...cacheRelayList.read, ...baseRelayList.read]
          const mergedWrite = [...cacheRelayList.write, ...baseRelayList.write]
          const mergedOriginalRelays = new Map<string, TMailboxRelay>()

          cacheRelayList.originalRelays.forEach((relay) => {
            mergedOriginalRelays.set(relay.url, relay)
          })
          baseRelayList.originalRelays.forEach((relay) => {
            if (!mergedOriginalRelays.has(relay.url)) {
              mergedOriginalRelays.set(relay.url, relay)
            }
          })

          setRelayList({
            write: Array.from(new Set(mergedWrite)),
            read: Array.from(new Set(mergedRead)),
            originalRelays: Array.from(mergedOriginalRelays.values()),
            httpRead: baseRelayList.httpRead,
            httpWrite: baseRelayList.httpWrite,
            httpOriginalRelays: baseRelayList.httpOriginalRelays
          })
        } else {
          setRelayList(baseRelayList)
        }
        /** Before feed REQs: locals / HTTP index need personal-key policy from IDB (PWA skip-network path). */
        await client.syncViewerPersonalRelayKeys(account.pubkey)
      } else if (!userForcedAccountNetworkHydrate) {
        /** No NIP-65 / 10432 / 10243 in IDB — still set merged defaults immediately (never wait on network). */
        const quick = await client.peekRelayListFromStorage(account.pubkey)
        setRelayList(quick)
        await client.syncViewerPersonalRelayKeys(account.pubkey)
      }
      if (!userForcedAccountNetworkHydrate) {
        if (storedProfileEvent) {
          setProfileEvent(storedProfileEvent)
          setProfile(getProfileFromEvent(storedProfileEvent))
        }
        if (storedFollowListEvent) {
          setFollowListEvent(storedFollowListEvent)
        }
        if (storedMuteListEvent) {
          setMuteListEvent(storedMuteListEvent)
        }
        if (storedBookmarkListEvent) {
          setBookmarkListEvent(storedBookmarkListEvent)
        }
        if (storedFavoriteRelaysEvent) {
          setFavoriteRelaysEvent(storedFavoriteRelaysEvent)
        }
        if (storedUserEmojiListEvent) {
          setUserEmojiListEvent(storedUserEmojiListEvent)
        }
        if (storedInterestListEvent) {
          setInterestListEvent(storedInterestListEvent)
        }
        if (storedBlossomServerListEvent) {
          void client.updateBlossomServerListEventCache(storedBlossomServerListEvent)
        }
        setHttpRelayListEvent(storedHttpRelayListEvent ?? null)
      }

      /** Kind 10432: always surface IDB in UI (incl. forced network hydrate); network merge refines below. */
      if (storedCacheRelayListEvent) {
        setCacheRelayListEvent(storedCacheRelayListEvent)
      }

      const lastNetworkHydrateAt = storage.getAccountNetworkHydrateAt(account.pubkey)
      const hasLocalRelayAndProfile = !!storedRelayListEvent && !!storedProfileEvent
      const freshSignupSkipNetwork = shouldSkipNetworkHydrateForFreshSignup(account.pubkey)
      const missingPublishedFavoriteRelays = !storedFavoriteRelaysEvent
      const skipNetworkHydrate =
        !userForcedAccountNetworkHydrate &&
        (freshSignupSkipNetwork ||
          (hasLocalRelayAndProfile &&
            !missingPublishedFavoriteRelays &&
            typeof lastNetworkHydrateAt === 'number' &&
            Date.now() - lastNetworkHydrateAt < ACCOUNT_SESSION_NETWORK_HYDRATE_MIN_INTERVAL_MS))

      if (!skipNetworkHydrate) {
        /** Only block interactive UI when the user explicitly requested a full network refresh. */
        if (userForcedAccountNetworkHydrate) {
          setIsAccountSessionHydrating(true)
        }
        /** Personal-relay policy must be synced before network REQs so profile index relays stay allowed. */
        await client.syncViewerPersonalRelayKeys(account.pubkey)
        const hydrateNetworkRelays = buildAccountSessionNetworkHydrateRelayUrls({
          relayListEvent: storedRelayListEvent,
          cacheRelayListEvent: storedCacheRelayListEvent,
          httpRelayListEvent: storedHttpRelayListEvent ?? null,
          favoriteRelaysEvent: storedFavoriteRelaysEvent,
          blockedRelays
        })
        const storedMailbox = storedRelayListEvent
          ? getRelayListFromEvent(storedRelayListEvent, blockedRelays)
          : { write: [] as string[], read: [] as string[] }

        const relayListEvents = await queryService.fetchEvents(
          hydrateNetworkRelays,
          {
            kinds: [kinds.RelayList],
            authors: [account.pubkey]
          },
          hydrateFetchOpts
        )
        if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) {
          return controller
        }
        const relayListEventFromBroad = getLatestEvent(relayListEvents) ?? storedRelayListEvent
        const writeOutboxUrls = Array.from(
          new Set([
            ...storedMailbox.write,
            ...(relayListEventFromBroad
              ? getRelayListFromEvent(relayListEventFromBroad, blockedRelays).write
              : [])
          ])
        )

        const [
          fromWriteOutboxes,
          cacheRelayListEvents,
          httpRelayListEvents,
          favoriteRelaysEvents,
          blockedRelaysEvents
        ] = await Promise.all([
          fetchViewerListReplaceablesFromWriteOutboxes(
            queryService,
            account.pubkey,
            writeOutboxUrls,
            hydrateFetchOpts
          ),
          queryService.fetchEvents(
            hydrateNetworkRelays,
            {
              kinds: [ExtendedKind.CACHE_RELAYS],
              authors: [account.pubkey]
            },
            hydrateFetchOpts
          ),
          queryService.fetchEvents(
            hydrateNetworkRelays,
            {
              kinds: [ExtendedKind.HTTP_RELAY_LIST],
              authors: [account.pubkey],
              limit: 1
            },
            hydrateFetchOpts
          ),
          queryService.fetchEvents(
            hydrateNetworkRelays,
            {
              kinds: [ExtendedKind.FAVORITE_RELAYS],
              authors: [account.pubkey],
              limit: 1
            },
            hydrateFetchOpts
          ),
          queryService.fetchEvents(
            hydrateNetworkRelays,
            {
              kinds: [ExtendedKind.BLOCKED_RELAYS],
              authors: [account.pubkey],
              limit: 1
            },
            hydrateFetchOpts
          )
        ])
      if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) {
        return controller
      }
      const relayListEvent = pickNewestListEvent(
        relayListEventFromBroad,
        fromWriteOutboxes.get(kinds.RelayList)
      )
      const cacheRelayListEvent = mergeHydratedCacheRelayListEvents(
        [
          ...cacheRelayListEvents,
          ...(fromWriteOutboxes.get(ExtendedKind.CACHE_RELAYS)
            ? [fromWriteOutboxes.get(ExtendedKind.CACHE_RELAYS)!]
            : [])
        ],
        storedCacheRelayListEvent
      )
      const httpRelayListEventFetched = mergeHydratedHttpRelayListEvents(
        [
          ...httpRelayListEvents,
          ...(fromWriteOutboxes.get(ExtendedKind.HTTP_RELAY_LIST)
            ? [fromWriteOutboxes.get(ExtendedKind.HTTP_RELAY_LIST)!]
            : [])
        ],
        storedHttpRelayListEvent
      )
      const favoriteRelaysEventFromNetwork = pickNewestListEvent(
        getLatestEvent(favoriteRelaysEvents),
        fromWriteOutboxes.get(ExtendedKind.FAVORITE_RELAYS) ?? null
      )
      const blockedRelaysEventFromNetwork = pickNewestListEvent(
        getLatestEvent(blockedRelaysEvents),
        fromWriteOutboxes.get(ExtendedKind.BLOCKED_RELAYS) ?? null
      )
      if (relayListEvent) {
        client.updateRelayListCache(relayListEvent)
      }
      await Promise.all([
        relayListEvent ? indexedDb.putReplaceableEvent(relayListEvent).catch(() => {}) : Promise.resolve(),
        cacheRelayListEvent ? indexedDb.putReplaceableEvent(cacheRelayListEvent).catch(() => {}) : Promise.resolve(),
        httpRelayListEventFetched
          ? indexedDb.putReplaceableEvent(httpRelayListEventFetched).catch(() => {})
          : Promise.resolve(),
        favoriteRelaysEventFromNetwork
          ? indexedDb.putReplaceableEvent(favoriteRelaysEventFromNetwork).catch(() => {})
          : Promise.resolve(),
        blockedRelaysEventFromNetwork
          ? indexedDb.putReplaceableEvent(blockedRelaysEventFromNetwork).catch(() => {})
          : Promise.resolve()
      ])
      await client.syncViewerPersonalRelayKeys(account.pubkey)
      if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
        setCacheRelayListEvent(cacheRelayListEvent ?? storedCacheRelayListEvent ?? null)
        setHttpRelayListEvent(httpRelayListEventFetched)
        if (favoriteRelaysEventFromNetwork) {
          setFavoriteRelaysEvent(favoriteRelaysEventFromNetwork)
        }
        if (blockedRelaysEventFromNetwork) {
          setBlockedRelaysEvent(blockedRelaysEventFromNetwork)
          setViewerBlockedRelayUrls(parseBlockedRelayUrlsFromEvent(blockedRelaysEventFromNetwork))
        }
      }

      const fetchRelays = buildAccountSessionNetworkHydrateRelayUrls({
        relayListEvent: relayListEvent ?? storedRelayListEvent,
        cacheRelayListEvent: cacheRelayListEvent ?? storedCacheRelayListEvent,
        httpRelayListEvent: httpRelayListEventFetched ?? storedHttpRelayListEvent ?? null,
        favoriteRelaysEvent: favoriteRelaysEventFromNetwork ?? storedFavoriteRelaysEvent,
        blockedRelays
      })
      const profileBatchKinds = AUTHOR_PROFILE_VIEW_REPLACEABLE_KINDS.filter(
        (k) =>
          k !== kinds.RelayList &&
          k !== ExtendedKind.CACHE_RELAYS &&
          k !== ExtendedKind.HTTP_RELAY_LIST &&
          k !== ExtendedKind.FAVORITE_RELAYS &&
          k !== ExtendedKind.BLOCKED_RELAYS
      )
      const [mergedRelayList, events] = await Promise.all([
        client.peekRelayListFromStorage(account.pubkey),
        queryService.fetchEvents(
          fetchRelays,
          [
            {
              kinds: [...profileBatchKinds],
              authors: [account.pubkey]
            }
          ],
          hydrateFetchOpts
        )
      ])
      if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) {
        return controller
      }
      setRelayList(mergedRelayList)
      const sortedEvents = events.sort((a, b) => b.created_at - a.created_at)
    const profileEvent = sortedEvents.find((e) => e.kind === kinds.Metadata)
    const paymentInfoEvent = sortedEvents
      .filter((e) => e.kind === ExtendedKind.PAYMENT_INFO)
      .sort((a, b) => b.created_at - a.created_at)[0]
    const followListEvent = sortedEvents.find((e) => e.kind === kinds.Contacts)
      const muteListEvent = sortedEvents.find((e) => e.kind === kinds.Mutelist)
      const bookmarkListEvent = sortedEvents.find((e) => e.kind === kinds.BookmarkList)
      const interestListEvent = sortedEvents.find((e) => e.kind === INTEREST_LIST_KIND)
      const favoriteRelaysEvent =
        favoriteRelaysEventFromNetwork ??
        sortedEvents.find((e) => e.kind === ExtendedKind.FAVORITE_RELAYS)
      const blockedRelaysEvent =
        blockedRelaysEventFromNetwork ??
        sortedEvents.find((e) => e.kind === ExtendedKind.BLOCKED_RELAYS)
      const blossomServerListEvent = sortedEvents.find(
        (e) => e.kind === ExtendedKind.BLOSSOM_SERVER_LIST
      )
      const userEmojiListEvent = sortedEvents.find((e) => e.kind === kinds.UserEmojiList)

      const safePutReplaceable = async (evt: Event | undefined): Promise<Event | undefined> => {
        if (!evt) return undefined
        try {
          return await indexedDb.putReplaceableEvent(evt)
        } catch {
          return evt
        }
      }

      const [
        resolvedProfilePut,
        resolvedPaymentPut,
        resolvedFollowPut,
        resolvedMutePut,
        resolvedBookmarkPut,
        resolvedInterestPut,
        resolvedFavoritePut,
        resolvedBlockedPut,
        resolvedUserEmojiPut
      ] = await Promise.all([
        safePutReplaceable(profileEvent),
        safePutReplaceable(paymentInfoEvent),
        safePutReplaceable(followListEvent),
        safePutReplaceable(muteListEvent),
        safePutReplaceable(bookmarkListEvent),
        safePutReplaceable(interestListEvent),
        safePutReplaceable(favoriteRelaysEvent),
        safePutReplaceable(blockedRelaysEvent),
        safePutReplaceable(userEmojiListEvent)
      ])

      if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) {
        return controller
      }

      if (profileEvent) {
        const resolvedProfileEvent = resolvedProfilePut ?? profileEvent
        try {
          await replaceableEventService.updateReplaceableEventCache(resolvedProfileEvent)
        } catch (e) {
          logger.warn('[NostrProvider] replaceableEventService cache update failed for profile', { error: e })
          try {
            await replaceableEventService.updateReplaceableEventCache(profileEvent)
          } catch {}
        }
        setProfileEvent(resolvedProfileEvent)
        setProfile(getProfileFromEvent(resolvedProfileEvent))
      } else if (!storedProfileEvent) {
        setProfile({
          pubkey: account.pubkey,
          npub: pubkeyToNpub(account.pubkey) ?? '',
          username: formatPubkey(account.pubkey)
        })
      }
      if (paymentInfoEvent) {
        const resolvedPayment = resolvedPaymentPut ?? paymentInfoEvent
        try {
          await replaceableEventService.updateReplaceableEventCache(resolvedPayment)
        } catch {
          try {
            await replaceableEventService.updateReplaceableEventCache(paymentInfoEvent)
          } catch {}
        }
      }
      if (followListEvent) {
        if (resolvedFollowPut && resolvedFollowPut.id === followListEvent.id) {
          setFollowListEvent(followListEvent)
        }
      } else {
        // Hydrate batch uses limited relays; fallback fetches from broader set (author relays, etc.)
        const trySetFollowList = (evt: Event) => {
          if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) return
          indexedDb
            .putReplaceableEvent(evt)
            .then(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setFollowListEvent(evt)
                logger.info('[NostrProvider] Follow list loaded via fallback fetch')
              }
            })
            .catch(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setFollowListEvent(evt)
              }
            })
        }
        const followListRelays = Array.from(
          new Set([
            ...mergedRelayList.write.map((u) => normalizeUrl(u) || u),
            ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u)
          ])
        ).filter(Boolean)
        queryService
          .fetchEvents(followListRelays, {
            authors: [account.pubkey],
            kinds: [kinds.Contacts],
            limit: 1
          }, hydrateFetchOpts)
          .then((evts) => {
            const evt = evts.sort((a, b) => b.created_at - a.created_at)[0]
            if (evt && hydrationGenForThisRun === accountHydrationGenerationRef.current) {
              trySetFollowList(evt)
              return
            }
            client.fetchFollowListEvent(account.pubkey, followListRelays).then((f) => {
              if (f) trySetFollowList(f)
            })
          })
          .catch(() => {
            client.fetchFollowListEvent(account.pubkey, followListRelays).then((f) => {
              if (f) trySetFollowList(f)
            })
          })
      }
      if (muteListEvent) {
        if (resolvedMutePut && resolvedMutePut.id === muteListEvent.id) {
          setMuteListEvent(muteListEvent)
        }
      } else {
        const trySetMuteList = (evt: Event) => {
          if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) return
          indexedDb
            .putReplaceableEvent(evt)
            .then(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setMuteListEvent(evt)
                logger.info('[NostrProvider] Mute list loaded via fallback fetch')
              }
            })
            .catch(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setMuteListEvent(evt)
              }
            })
        }
        const muteListRelays = Array.from(
          new Set([
            ...mergedRelayList.write.map((u) => normalizeUrl(u) || u),
            ...mergedRelayList.read.map((u) => normalizeUrl(u) || u),
            ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
            ...PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
            ...FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u)
          ])
        ).filter(Boolean)
        queryService
          .fetchEvents(muteListRelays, {
            authors: [account.pubkey],
            kinds: [kinds.Mutelist],
            limit: 10
          }, hydrateFetchOpts)
          .then((evts) => {
            const evt = getLatestEvent(evts)
            if (evt && hydrationGenForThisRun === accountHydrationGenerationRef.current) {
              trySetMuteList(evt)
              return
            }
            client.fetchMuteListEvent(account.pubkey).then((m) => {
              if (m) trySetMuteList(m)
            })
          })
          .catch(() => {
            client.fetchMuteListEvent(account.pubkey).then((m) => {
              if (m) trySetMuteList(m)
            })
          })
      }
      if (bookmarkListEvent) {
        if (resolvedBookmarkPut && resolvedBookmarkPut.id === bookmarkListEvent.id) {
          setBookmarkListEvent(bookmarkListEvent)
        }
      }
      if (interestListEvent) {
        if (resolvedInterestPut && resolvedInterestPut.id === interestListEvent.id) {
          setInterestListEvent(interestListEvent)
        }
      }
      if (favoriteRelaysEvent) {
        if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
          setFavoriteRelaysEvent(resolvedFavoritePut ?? favoriteRelaysEvent)
        }
      } else if (!storedFavoriteRelaysEvent) {
        const trySetFavoriteRelays = (evt: Event) => {
          if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) return
          void indexedDb
            .putReplaceableEvent(evt)
            .then((stored) => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setFavoriteRelaysEvent(stored)
              }
            })
            .catch(() => {
              if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                setFavoriteRelaysEvent(evt)
              }
            })
        }
        void replaceableEventService
          .fetchReplaceableEvent(account.pubkey, ExtendedKind.FAVORITE_RELAYS)
          .then((ev) => {
            if (ev) trySetFavoriteRelays(ev)
          })
          .catch(() => {})
      }
      if (blockedRelaysEvent) {
        if (resolvedBlockedPut && resolvedBlockedPut.id === blockedRelaysEvent.id) {
          setBlockedRelaysEvent(resolvedBlockedPut)

          // Update blockedRelays array and re-filter relay list
          const newBlockedRelays: string[] = []
          resolvedBlockedPut.tags.forEach(([tagName, tagValue]) => {
            if (tagName === 'relay' && tagValue) {
              const normalizedUrl = normalizeUrl(tagValue)
              if (normalizedUrl && !newBlockedRelays.includes(normalizedUrl)) {
                newBlockedRelays.push(normalizedUrl)
              }
            }
          })

          // Re-filter relay list with updated blocked relays
          if (relayListEvent) {
            const updatedRelayList = getRelayListFromEvent(relayListEvent, newBlockedRelays)
            setRelayList(updatedRelayList)
          }
        }
      }
      if (blossomServerListEvent) {
        void client.updateBlossomServerListEventCache(blossomServerListEvent)
      }
      if (userEmojiListEvent) {
        if (resolvedUserEmojiPut && resolvedUserEmojiPut.id === userEmojiListEvent.id) {
          setUserEmojiListEvent(userEmojiListEvent)
        }
      }

      try {
        void replaceableEventService
          .refreshAuthorPublishedReplaceablesFromRelays(
            account.pubkey,
            userForcedAccountNetworkHydrate ? { force: true } : undefined
          )
          .catch((err) => {
            logger.debug('[NostrProvider] Author replaceables refresh after hydrate failed', { error: err })
          })
      } catch (err) {
        logger.debug('[NostrProvider] Author replaceables refresh after hydrate failed', { error: err })
      }

      await syncViewerAccountReplaceablesFromIndexedDb(account.pubkey)

        storage.setAccountNetworkHydrateAt(account.pubkey, Date.now())
        void client.runSessionPrewarm({ pubkey: account.pubkey, signal: controller.signal })
        logger.debug('[NostrProvider] Account session hydrate: core relay/profile merge finished; client prewarm started (parallel)', {
          pubkeySlice: account.pubkey.slice(0, 12)
        })
      } else {
        logger.debug('[NostrProvider] Skipped network hydrate (within min interval); IndexedDB cache only', {
          pubkeySlice: account.pubkey.slice(0, 12),
          freshSignupSkipNetwork,
          lastNetworkHydrateAt,
          ageMs: Date.now() - (lastNetworkHydrateAt ?? 0)
        })
        if (storedRelayListEvent) {
          client.updateRelayListCache(storedRelayListEvent)
        }
        await client.syncViewerPersonalRelayKeys(account.pubkey)
        void client.runSessionPrewarm({ pubkey: account.pubkey, signal: controller.signal })
        if (!storedFollowListEvent && !freshSignupSkipNetwork) {
          const trySetFollowListSkip = (evt: Event) => {
            if (hydrationGenForThisRun !== accountHydrationGenerationRef.current) return
            indexedDb
              .putReplaceableEvent(evt)
              .then(() => {
                if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                  setFollowListEvent(evt)
                  logger.info('[NostrProvider] Follow list loaded via fallback (skip-network path)')
                }
              })
              .catch(() => {
                if (hydrationGenForThisRun === accountHydrationGenerationRef.current) {
                  setFollowListEvent(evt)
                }
              })
          }
          const getFollowListRelays = async () => {
            const rl = storedRelayListEvent
              ? getRelayListFromEvent(storedRelayListEvent, blockedRelays)
              : { write: [] as string[], read: [] as string[] }
            const writes = rl.write.map((u) => normalizeUrl(u) || u).filter(Boolean)
            return Array.from(new Set([...writes, ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u)])).filter(Boolean)
          }
          getFollowListRelays().then((relays) =>
            client.fetchFollowListEvent(account.pubkey, relays.length > 0 ? relays : undefined).then((fallback) => {
              if (fallback) trySetFollowListSkip(fallback)
            })
          )
        }
      }
      lastNetworkHydrateAccountPubkeyRef.current = account.pubkey
      return controller
    }
    const promise = init()
    const wallTimer = window.setTimeout(() => {
      if (accountHydrationGenerationRef.current === hydrationGenForThisRun) {
        logger.warn('[NostrProvider] Account session hydrate exceeded wall time; clearing spinner', {
          pubkeySlice: account?.pubkey?.slice(0, 12),
          hydrationGen: hydrationGenForThisRun,
          wallMs: ACCOUNT_SESSION_HYDRATE_WALL_MS
        })
        setIsAccountSessionHydrating(false)
      }
    }, ACCOUNT_SESSION_HYDRATE_WALL_MS)
    void promise.finally(() => {
      window.clearTimeout(wallTimer)
      const r = manualNetworkHydrateResolveRef.current
      manualNetworkHydrateResolveRef.current = null
      r?.()
    })
    const finishHydration = () => {
      if (
        hydrationGenForThisRun >= 0 &&
        accountHydrationGenerationRef.current === hydrationGenForThisRun
      ) {
        setIsAccountSessionHydrating(false)
      }
    }
    promise.then(finishHydration).catch((e) => {
      logger.error('[NostrProvider] Account session hydrate failed', { error: e })
      finishHydration()
    })
    return () => {
      window.clearTimeout(wallTimer)
      promise
        .then((controller) => {
          controller?.abort()
        })
        .catch(() => {})
    }
  }, [account, accountNetworkHydrateBump, syncViewerAccountReplaceablesFromIndexedDb])

  /** Clear persisted post draft when user logs out or switches accounts (not on initial load). */
  const prevAccountPubkeyRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const prev = prevAccountPubkeyRef.current
    const curr = account?.pubkey ?? null
    prevAccountPubkeyRef.current = curr
    if (postEditorService.isComposerShellOpen) {
      return
    }
    if (prev != null && curr != null && prev !== curr) {
      postEditorCache.clearOnAccountChange()
    } else if (prev != null && curr === null) {
      postEditorCache.clearOnAccountChange()
    }
  }, [account?.pubkey])

  /** Recovery: if hydrate finished but follow list is still null, fetch using user write + search relays. */
  useEffect(() => {
    if (!account || followListEvent !== null || isAccountSessionHydrating) return
    let cancelled = false
    const resolveRelays = async () => {
      if (relayList) return relayList
      return client.fetchRelayList(account.pubkey)
    }
    resolveRelays()
      .then((rl) => {
        const writes = rl.write.map((u) => normalizeUrl(u) || u).filter(Boolean)
        const relays = Array.from(new Set([...writes, ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u)])).filter(Boolean)
        return client.fetchFollowListEvent(account.pubkey, relays.length > 0 ? relays : undefined)
      })
      .then((evt) => {
        if (!cancelled && evt) setFollowListEvent(evt)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, followListEvent, isAccountSessionHydrating, relayList])

  /** Recovery: if hydrate finished but mute list is still null, query outboxes + search + profile relays (same gap as follow-list recovery). */
  useEffect(() => {
    if (!account || muteListEvent !== null || isAccountSessionHydrating) return
    let cancelled = false
    const resolveRelays = async () => {
      if (relayList) return relayList
      return client.fetchRelayList(account.pubkey)
    }
    resolveRelays()
      .then((rl) => {
        const relays = Array.from(
          new Set([
            ...rl.write.map((u) => normalizeUrl(u) || u),
            ...rl.read.map((u) => normalizeUrl(u) || u),
            ...SEARCHABLE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
            ...PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u),
            ...FAST_READ_RELAY_URLS.map((u) => normalizeUrl(u) || u)
          ])
        ).filter(Boolean)
        return queryService.fetchEvents(relays, {
          authors: [account.pubkey],
          kinds: [kinds.Mutelist],
          limit: 10
        })
      })
      .then((evts) => {
        const evt = getLatestEvent(evts)
        if (!cancelled && evt) {
          void indexedDb.putReplaceableEvent(evt).catch(() => {})
          setMuteListEvent(evt)
          return
        }
        if (!cancelled) {
          return client.fetchMuteListEvent(account.pubkey).then((m) => {
            if (!cancelled && m) {
              void indexedDb.putReplaceableEvent(m).catch(() => {})
              setMuteListEvent(m)
            }
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          client.fetchMuteListEvent(account.pubkey).then((m) => {
            if (!cancelled && m) {
              void indexedDb.putReplaceableEvent(m).catch(() => {})
              setMuteListEvent(m)
            }
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [account, muteListEvent, isAccountSessionHydrating, relayList])

  useEffect(() => {
    const EVENT = ReplaceableEventService.AUTHOR_REPLACEABLES_REFRESHED_EVENT
    const onRefreshed: EventListener = (domEvt) => {
      const ce = domEvt as unknown as CustomEvent<{ pubkey?: string }>
      const pk = ce.detail?.pubkey?.toLowerCase()
      const acc = accountForReplaceablesSyncRef.current
      if (!pk || !acc?.pubkey || pk !== acc.pubkey.toLowerCase()) return
      void syncViewerAccountReplaceablesFromIndexedDb(acc.pubkey)
    }
    window.addEventListener(EVENT, onRefreshed)
    return () => window.removeEventListener(EVENT, onRefreshed)
  }, [syncViewerAccountReplaceablesFromIndexedDb])

  useEffect(() => {
    if (!account) return

    const initInteractions = async () => {
      const pubkey = account.pubkey
      const relayList = await client.fetchRelayList(pubkey)
      const events = await queryService.fetchEvents(relayList.write.slice(0, 4), [
        {
          authors: [pubkey],
          kinds: [kinds.Reaction, ExtendedKind.EXTERNAL_REACTION, kinds.Repost, ExtendedKind.GENERIC_REPOST],
          limit: 100
        },
        {
          '#p': [pubkey],
          kinds: [kinds.Zap],
          limit: 100
        }
      ])
      noteStatsService.updateNoteStatsByEvents(events)
    }
    initInteractions()
  }, [account])

  useEffect(() => {
    /** Use `client.setSigner` so the client, QueryService, and scoped NIP-42 pool auth stay aligned. */
    client.setSigner(signer ?? undefined, account?.signerType)
  }, [signer, account?.signerType])

  useEffect(() => {
    if (account) {
      client.pubkey = account.pubkey
      void client.syncViewerPersonalRelayKeys(account.pubkey)
    } else {
      client.pubkey = undefined
      void client.syncViewerPersonalRelayKeys()
    }
  }, [account])

  useEffect(() => {
    if (!account?.pubkey) {
      void customEmojiService.init(null, null)
      return
    }
    void customEmojiService.init(userEmojiListEvent, account.pubkey, profileEvent)
  }, [userEmojiListEvent, account?.pubkey, profileEvent])

  const hasNostrLoginHash = () => {
    return window.location.hash && window.location.hash.startsWith('#nostr-login')
  }

  const loginByNostrLoginHash = async () => {
    const credential = window.location.hash.replace('#nostr-login=', '')
    const urlWithoutHash = window.location.href.split('#')[0]
    history.replaceState(null, '', urlWithoutHash)

    if (credential.startsWith('bunker://')) {
      return await bunkerLogin(credential)
    } else if (credential.startsWith('ncryptsec')) {
      return await ncryptsecLogin(credential)
    } else if (credential.startsWith('nsec')) {
      return await nsecLogin(credential)
    }
  }

  const syncAccountPointersFromStorage = () => {
    setAccounts(
      storage.getAccounts().map((act) => ({ pubkey: act.pubkey, signerType: act.signerType }))
    )
  }

  const normalizeLoginAccount = (act: TAccount): TAccount => {
    const pubkey =
      pubkeyFromNip07Extension(act.pubkey) ??
      (isValidPubkey(normalizeHexPubkey(act.pubkey))
        ? normalizeHexPubkey(act.pubkey)
        : act.pubkey)
    return { ...act, pubkey }
  }

  const clearSessionUiForAccountChange = () => {
    setProfile(null)
    setProfileEvent(null)
    setRelayList(null)
    setNsec(null)
    setNcryptsec(null)
    setFavoriteRelaysEvent(null)
    setFollowListEvent(null)
    setMuteListEvent(null)
    setBookmarkListEvent(null)
    setInterestListEvent(null)
    setCacheRelayListEvent(null)
    setHttpRelayListEvent(undefined)
    setBlockedRelaysEvent(null)
    setUserEmojiListEvent(null)
  }

  const login = (signer: ISigner, act: TAccount) => {
    const normalized = normalizeLoginAccount(act)
    const prev = accountForReplaceablesSyncRef.current
    if (normalized.signerType === 'nip-07') {
      intentionalNip07ReadOnlyPubkeyRef.current = null
    }
    storage.addAccount(normalized)
    syncAccountPointersFromStorage()
    storage.switchAccount(normalized)

    const sessionChanged =
      !prev ||
      !hexPubkeysEqual(normalizeHexPubkey(prev.pubkey), normalized.pubkey) ||
      prev.signerType !== normalized.signerType

    if (sessionChanged) {
      clearSessionUiForAccountChange()
      accountHydrationGenerationRef.current += 1
      lastNetworkHydrateAccountPubkeyRef.current = null
    }

    const pointer = { pubkey: normalized.pubkey, signerType: normalized.signerType }
    setAccount(pointer)
    setSigner(signer)
    accountForReplaceablesSyncRef.current = pointer
    client.setSigner(signer, normalized.signerType)
    client.pubkey = normalized.pubkey
    void client.syncViewerPersonalRelayKeys(normalized.pubkey)

    if (sessionChanged) {
      setAccountNetworkHydrateBump((n) => n + 1)
    }
    return normalized.pubkey
  }

  const removeAccount = (act: TAccountPointer) => {
    storage.removeAccount(act)
    syncAccountPointersFromStorage()
    if (account?.pubkey === act.pubkey) {
      setAccount(null)
      setSigner(null)
    }
  }

  const discardLocalPrivateKey = () => {
    if (!account?.pubkey) {
      throw new Error('Not logged in')
    }
    const stored = storage.findAccount(account)
    if (!stored || (stored.signerType !== 'nsec' && stored.signerType !== 'ncryptsec')) {
      throw new Error('No local private key stored for this account')
    }
    storage.removeAccount(stored)
    const npub = nip19.npubEncode(stored.pubkey)
    const readOnlyAccount: TAccount = {
      pubkey: stored.pubkey,
      signerType: 'npub',
      npub
    }
    const newAccounts = storage.addAccount(readOnlyAccount)
    storage.switchAccount(readOnlyAccount)
    setAccounts(newAccounts)
    setAccount({ pubkey: stored.pubkey, signerType: 'npub' })
    setNsec(null)
    setNcryptsec(null)
    const npubSigner = new NpubSigner()
    npubSigner.login(npub)
    setSigner(npubSigner)
  }

  const loginAnon = (): null => {
    setAnonSessionPersisted(true)
    clearSessionUiForAccountChange()
    accountHydrationGenerationRef.current += 1
    lastNetworkHydrateAccountPubkeyRef.current = null

    const pointer = createAnonAccountPointer()
    setAccount(pointer)
    setSigner(null)
    setNsec(null)
    setNcryptsec(null)
    accountForReplaceablesSyncRef.current = pointer
    client.setSigner(undefined, 'anon')
    client.pubkey = undefined
    return null
  }

  const switchAccount = async (act: TAccountPointer | null): Promise<string | null> => {
    intentionalNip07ReadOnlyPubkeyRef.current = null
    if (!act) {
      setAnonSessionPersisted(false)
      storage.switchAccount(null)
      setAccount(null)
      setSigner(null)
      window.dispatchEvent(new CustomEvent(APP_RESET_TO_LANDING_EVENT))
      return null
    }
    if (isAnonAccount(act)) {
      loginAnon()
      return null
    }
    setAnonSessionPersisted(false)
    const result = await loginWithAccountPointer(act, { userInitiatedSwitch: true })
    // If loginWithAccountPointer fell back to read-only npub it skips storage.switchAccount.
    // Persist the user's intent here so session restore and NIP-07 recovery target this row.
    if (result !== null) {
      const storedFull = findStoredAccountForPointer(storage.getAccounts(), act)
      if (storedFull && !isSameAccount(storage.getCurrentAccount(), storedFull)) {
        storage.switchAccount(storedFull)
        syncAccountPointersFromStorage()
        setNip07RecoveryBump((b) => b + 1)
      }
    }
    return result
  }

  /** Browse read-only, or connect NIP-07 when the extension already matches this pubkey. */
  const viewAccountAsReadOnly = async (act: TAccountPointer): Promise<string | null> => {
    const stored = storage.findAccount(act)
    const normalized = normalizeLoginAccount(
      stored ?? { pubkey: act.pubkey, signerType: act.signerType }
    )
    if (!isValidPubkey(normalized.pubkey)) return null

    const nip07Row =
      stored?.signerType === 'nip-07'
        ? stored
        : storage
            .getAccounts()
            .find(
              (a) =>
                a.signerType === 'nip-07' &&
                hexPubkeysEqual(normalizeHexPubkey(a.pubkey), normalized.pubkey)
            )
    if (nip07Row) {
      try {
        const nip07Signer = new Nip07Signer()
        await nip07Signer.init()
        const extPubkey = pubkeyFromNip07Extension(await nip07Signer.getPublicKey())
        if (extPubkey && hexPubkeysEqual(extPubkey, normalized.pubkey)) {
          return login(nip07Signer, nip07Row)
        }
      } catch {
        // Fall through to intentional read-only browse.
      }
    }

    intentionalNip07ReadOnlyPubkeyRef.current = normalized.pubkey.toLowerCase()

    const storageRow: TAccount =
      stored ??
      ({
        pubkey: normalized.pubkey,
        signerType: 'npub',
        npub: nip19.npubEncode(normalized.pubkey)
      } as TAccount)
    storage.switchAccount(
      stored?.signerType === 'nip-07' ? stored : storageRow
    )
    syncAccountPointersFromStorage()

    const npubSigner = new NpubSigner()
    npubSigner.login(nip19.npubEncode(normalized.pubkey))

    return flushSync(() => {
      const prev = accountForReplaceablesSyncRef.current
      const sessionChanged =
        !prev ||
        !hexPubkeysEqual(normalizeHexPubkey(prev.pubkey), normalized.pubkey) ||
        prev.signerType !== 'npub'

      if (sessionChanged) {
        clearSessionUiForAccountChange()
        accountHydrationGenerationRef.current += 1
        lastNetworkHydrateAccountPubkeyRef.current = null
      }

      const pointer = { pubkey: normalized.pubkey, signerType: 'npub' as const }
      setAccount(pointer)
      setSigner(npubSigner)
      accountForReplaceablesSyncRef.current = pointer
      client.setSigner(npubSigner, 'npub')
      client.pubkey = normalized.pubkey
      void client.syncViewerPersonalRelayKeys(normalized.pubkey)

      if (sessionChanged) {
        setAccountNetworkHydrateBump((n) => n + 1)
      }
      return normalized.pubkey
    })
  }

  const finishNcryptsecPasswordPrompt = useCallback((password: string | null) => {
    const resolve = ncryptsecPasswordResolveRef.current
    if (!resolve) return
    ncryptsecPasswordResolveRef.current = null
    setNcryptsecPasswordOpen(false)
    resolve(password)
  }, [])

  const askNcryptsecPassword = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      const prev = ncryptsecPasswordResolveRef.current
      if (prev) prev(null)
      ncryptsecPasswordResolveRef.current = resolve
      setNcryptsecPasswordOpen(true)
    })
  }, [])

  const nsecLogin = async (nsecOrHex: string, password?: string, needSetup?: boolean) => {
    const nsecSigner = new NsecSigner()
    let privkey: Uint8Array
    if (nsecOrHex.startsWith('nsec')) {
      const { type, data } = nip19.decode(nsecOrHex)
      if (type !== 'nsec') {
        throw new Error('invalid nsec or hex')
      }
      privkey = data
    } else if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
      privkey = hexToBytes(nsecOrHex)
    } else {
      throw new Error('invalid nsec or hex')
    }
    const pubkey = nsecSigner.login(privkey)
    const act: TAccount = password
      ? { pubkey, signerType: 'ncryptsec', ncryptsec: nip49.encrypt(privkey, password) }
      : { pubkey, signerType: 'nsec', nsec: nip19.nsecEncode(privkey) }

    let signedTemplate: Record<keyof TNewUserTemplateDrafts, VerifiedEvent> | null = null
    if (needSetup) {
      markFreshSignupSkipNetworkHydrate(pubkey)
      signedTemplate = await persistNewUserTemplateLocally(nsecSigner, pubkey)
    }

    login(nsecSigner, act)
    if (act.nsec) setNsec(act.nsec)
    if (act.ncryptsec) setNcryptsec(act.ncryptsec)

    if (needSetup && signedTemplate) {
      markNewUserTemplateBroadcastPending(pubkey)
      schedulePostSignupBackupPrompt(pubkey)
      storage.setAccountNetworkHydrateAt(pubkey, Date.now())
      clearFreshSignupSkipNetworkHydrate(pubkey)
    }
    return pubkey
  }

  const ncryptsecLogin = async (ncryptsec: string) => {
    const password = await askNcryptsecPassword()
    if (!password) {
      throw new Error('Password is required')
    }
    let privkey: Uint8Array
    try {
      privkey = nip49.decrypt(ncryptsec, password)
    } catch (e) {
      toast.error(t('Login failed') + ': ' + (e as Error).message)
      throw e
    }
    const browserNsecSigner = new NsecSigner()
    const pubkey = browserNsecSigner.login(privkey)
    return login(browserNsecSigner, { pubkey, signerType: 'ncryptsec', ncryptsec })
  }

  const npubLogin = async (npub: string) => {
    const npubSigner = new NpubSigner()
    const pubkey = npubSigner.login(npub)
    return login(npubSigner, { pubkey, signerType: 'npub', npub })
  }

  const nip07Login = async () => {
    if (nip07LoginInFlightRef.current) return null
    nip07LoginInFlightRef.current = true
    setIsNip07LoginInFlight(true)
    try {
      const nip07Signer = new Nip07Signer()
      await nip07Signer.init()
      const pubkey = pubkeyFromNip07Extension(await nip07Signer.getPublicKey())
      if (!pubkey) {
        throw new Error('Extension returned an invalid pubkey')
      }
      const readOnlyDup = storage
        .getAccounts()
        .find((a) => a.signerType === 'npub' && hexPubkeysEqual(a.pubkey, pubkey))
      if (readOnlyDup) {
        storage.removeAccount(readOnlyDup)
        syncAccountPointersFromStorage()
      }
      return flushSync(() => login(nip07Signer, { pubkey, signerType: 'nip-07' }))
    } catch (err) {
      toast.error(t('Login failed') + ': ' + (err as Error).message)
      throw err
    } finally {
      nip07LoginInFlightRef.current = false
      setIsNip07LoginInFlight(false)
    }
  }

  const bunkerLogin = async (bunker: string) => {
    const bunkerSigner = new BunkerSigner()
    const pubkey = await bunkerSigner.login(bunker)
    if (!pubkey) {
      throw new Error('Invalid bunker')
    }
    const bunkerUrl = new URL(bunker)
    bunkerUrl.searchParams.delete('secret')
    return login(bunkerSigner, {
      pubkey,
      signerType: 'bunker',
      bunker: bunkerUrl.toString(),
      bunkerClientSecretKey: bunkerSigner.getClientSecretKey()
    })
  }

  const nostrConnectionLogin = async (clientSecretKey: Uint8Array, connectionString: string) => {
    const bunkerSigner = new NostrConnectionSigner(clientSecretKey, connectionString)
    const loginResult = await bunkerSigner.login()
    if (!loginResult.pubkey) {
      throw new Error('Invalid bunker')
    }
    const bunkerUrl = new URL(loginResult.bunkerString!)
    bunkerUrl.searchParams.delete('secret')
    return login(bunkerSigner, {
      pubkey: loginResult.pubkey,
      signerType: 'bunker',
      bunker: bunkerUrl.toString(),
      bunkerClientSecretKey: bunkerSigner.getClientSecretKey()
    })
  }

  const loginWithAccountPointer = async (
    act: TAccountPointer,
    options?: { userInitiatedSwitch?: boolean }
  ): Promise<string | null> => {
    if (isAnonAccount(act)) {
      loginAnon()
      return null
    }
    const fallbackToReadOnlyNpub = (pubkey: string, reason?: unknown): string => {
      const pk =
        accountPubkeyToHex(pubkey) ??
        (isValidPubkey(normalizeHexPubkey(pubkey)) ? normalizeHexPubkey(pubkey) : null)
      if (!pk) return pubkey

      const apply = (): string => {
        const npubSigner = new NpubSigner()
        npubSigner.login(nip19.npubEncode(pk))
        const prev = accountForReplaceablesSyncRef.current
        const sessionChanged =
          !prev || !hexPubkeysEqual(prev.pubkey, pk) || prev.signerType !== 'npub'

        if (sessionChanged) {
          clearSessionUiForAccountChange()
          accountHydrationGenerationRef.current += 1
          lastNetworkHydrateAccountPubkeyRef.current = null
        }

        const pointer = { pubkey: pk, signerType: 'npub' as const }
        setAccount(pointer)
        setSigner(npubSigner)
        accountForReplaceablesSyncRef.current = pointer
        client.setSigner(npubSigner, 'npub')
        client.pubkey = pk
        void client.syncViewerPersonalRelayKeys(pk)

        if (sessionChanged) {
          setAccountNetworkHydrateBump((n) => n + 1)
        }

        logger.warn('[NostrProvider] Signer unavailable during restore; using read-only session', {
          pubkeySlice: pk.slice(0, 12),
          reason: reason instanceof Error ? reason.message : String(reason ?? '')
        })
        return pk
      }

      return options?.userInitiatedSwitch ? flushSync(apply) : apply()
    }
    const currentAccountState = account

    const wantedPk = accountPubkeyToHex(act.pubkey)
    let storedAccount = findStoredAccountForPointer(storage.getAccounts(), act)
    if (!storedAccount) {
      if (!wantedPk) return null
      if (act.signerType === 'nip-07') {
        storedAccount = { pubkey: wantedPk, signerType: 'nip-07' }
      } else {
        return null
      }
    }
    if (storedAccount.signerType === 'nsec' || storedAccount.signerType === 'browser-nsec') {
      if (storedAccount.nsec) {
        try {
          const browserNsecSigner = new NsecSigner()
          browserNsecSigner.login(storedAccount.nsec)
          // Migrate to nsec
          if (storedAccount.signerType === 'browser-nsec') {
            storage.removeAccount(storedAccount)
            storedAccount = { ...storedAccount, signerType: 'nsec' }
            storage.addAccount(storedAccount)
          }
          return login(browserNsecSigner, storedAccount)
        } catch (err) {
          const pk = accountPubkeyToHex(storedAccount.pubkey)
          if (pk) {
            return fallbackToReadOnlyNpub(pk, err)
          }
        }
      }
    } else if (storedAccount.signerType === 'ncryptsec') {
      if (storedAccount.ncryptsec) {
        const password = await askNcryptsecPassword()
        if (!password) {
          return null
        }
        let privkey: Uint8Array
        try {
          privkey = nip49.decrypt(storedAccount.ncryptsec, password)
        } catch (e) {
          toast.error(t('Login failed') + ': ' + (e as Error).message)
          return null
        }
        const browserNsecSigner = new NsecSigner()
        browserNsecSigner.login(privkey)
        return login(browserNsecSigner, storedAccount)
      }
    } else if (storedAccount.signerType === 'nip-07') {
      const targetPk =
        wantedPk ?? accountPubkeyToHex(storedAccount.pubkey)
      if (!targetPk) return null
      try {
        const nip07Signer = new Nip07Signer()
        await nip07Signer.init()
        const pubkey = pubkeyFromNip07Extension(await nip07Signer.getPublicKey())
        if (!pubkey || !hexPubkeysEqual(pubkey, targetPk)) {
          throw new Error(NIP07_SIGNER_PUBKEY_MISMATCH_MSG)
        }
        storedAccount = { ...storedAccount, pubkey, signerType: 'nip-07' }
        return login(nip07Signer, storedAccount)
      } catch (err) {
        let lastNip07Err: unknown = err
        // One short retry avoids transient extension injection races on reload.
        try {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          const retrySigner = new Nip07Signer()
          await retrySigner.init()
          const retryPubkey = pubkeyFromNip07Extension(await retrySigner.getPublicKey())
          if (!retryPubkey || !hexPubkeysEqual(retryPubkey, targetPk)) {
            throw new Error(NIP07_SIGNER_PUBKEY_MISMATCH_MSG)
          }
          const healed = { ...storedAccount, pubkey: retryPubkey, signerType: 'nip-07' as const }
          return login(retrySigner, healed)
        } catch (retryErr) {
          lastNip07Err = retryErr
          // If this tab already has a working nip-07 signer for the same account, keep it.
          if (
            currentAccountState?.pubkey === storedAccount.pubkey &&
            currentAccountState.signerType === 'nip-07' &&
            signer
          ) {
            try {
              const currentPubkey = await signer.getPublicKey()
              if (hexPubkeysEqual(currentPubkey, targetPk)) {
                logger.info('[NostrProvider] Keeping existing NIP-07 signer after transient restore failure', {
                  pubkeySlice: targetPk.slice(0, 12)
                })
                return targetPk
              }
            } catch {
              // Ignore and fall through to read-only fallback.
            }
          }
        }
        if (
          (isNip07SignerPubkeyMismatchError(err) || isNip07SignerPubkeyMismatchError(lastNip07Err)) &&
          options?.userInitiatedSwitch
        ) {
          intentionalNip07ReadOnlyPubkeyRef.current = targetPk
        }
        return fallbackToReadOnlyNpub(targetPk, err)
      }
    } else if (storedAccount.signerType === 'bunker') {
      if (storedAccount.bunker && storedAccount.bunkerClientSecretKey) {
        const bunkerSigner = new BunkerSigner(storedAccount.bunkerClientSecretKey)
        const pubkey = await bunkerSigner.login(storedAccount.bunker, false)
        if (!pubkey) {
          storage.removeAccount(storedAccount)
          return null
        }
        if (pubkey !== storedAccount.pubkey) {
          storage.removeAccount(storedAccount)
          storedAccount = { ...storedAccount, pubkey }
          storage.addAccount(storedAccount)
        }
        return login(bunkerSigner, storedAccount)
      }
    } else if (storedAccount.signerType === 'npub' && storedAccount.npub) {
      const npubSigner = new NpubSigner()
      const pubkey = npubSigner.login(storedAccount.npub)
      if (!pubkey) {
        storage.removeAccount(storedAccount)
        return null
      }
      if (pubkey !== storedAccount.pubkey) {
        storage.removeAccount(storedAccount)
        storedAccount = { ...storedAccount, pubkey }
        storage.addAccount(storedAccount)
      }
      return login(npubSigner, storedAccount)
    }
    const missingCredentialsPk = accountPubkeyToHex(storedAccount.pubkey)
    if (missingCredentialsPk) {
      logger.warn('[NostrProvider] Stored account missing signer credentials; using read-only session', {
        pubkeySlice: missingCredentialsPk.slice(0, 12),
        signerType: storedAccount.signerType
      })
      return fallbackToReadOnlyNpub(
        missingCredentialsPk,
        new Error('missing signer credentials in storage')
      )
    }
    return null
  }

  const reconnectNip07ForPubkey = async (
    targetPk: string,
    nip07Template: TAccount
  ): Promise<boolean> => {
    try {
      const nip07Signer = new Nip07Signer()
      await nip07Signer.init()
      const extPubkey = pubkeyFromNip07Extension(await nip07Signer.getPublicKey())
      if (!extPubkey || !hexPubkeysEqual(extPubkey, targetPk)) {
        logger.info('[NostrProvider] NIP-07 reconnect: extension key mismatch', {
          wantedPubkeySlice: targetPk.slice(0, 12),
          extensionPubkeySlice: extPubkey?.slice(0, 12) ?? null
        })
        return false
      }
      intentionalNip07ReadOnlyPubkeyRef.current = null
      const act: TAccount = { ...nip07Template, pubkey: extPubkey, signerType: 'nip-07' }
      storage.switchAccount(act)
      syncAccountPointersFromStorage()
      login(nip07Signer, act)
      setNip07RecoveryBump((b) => b + 1)
      return true
    } catch (e) {
      logger.info('[NostrProvider] NIP-07 reconnect failed', {
        pubkeySlice: targetPk.slice(0, 12),
        error: e instanceof Error ? e.message : String(e)
      })
      return false
    }
  }

  /** Reconnect NIP-07 for the active read-only session (or stored preferred row). */
  const retryNip07SignerForPreferredAccount = useEventCallback(async (): Promise<boolean> => {
    const sessionPk =
      account?.signerType === 'npub' && account.pubkey
        ? accountPubkeyToHex(account.pubkey)
        : null
    if (!sessionPk) {
      const preferred = storage.getCurrentAccount()
      if (!preferred || preferred.signerType !== 'nip-07') return false
      const preferredPk = accountPubkeyToHex(preferred.pubkey)
      if (!preferredPk) return false
      return reconnectNip07ForPubkey(preferredPk, preferred)
    }
    const nip07Row = storage
      .getAccounts()
      .find((a) => a.signerType === 'nip-07' && hexPubkeysEqual(a.pubkey, sessionPk))
    return reconnectNip07ForPubkey(sessionPk, nip07Row ?? { pubkey: sessionPk, signerType: 'nip-07' })
  })

  const adoptCurrentExtensionNip07Identity = useEventCallback(async () => {
    try {
      intentionalNip07ReadOnlyPubkeyRef.current = null
      const nip07Signer = new Nip07Signer()
      await nip07Signer.init()
      const extPubkey = pubkeyFromNip07Extension(await nip07Signer.getPublicKey())
      if (!extPubkey) {
        throw new Error('Empty or invalid pubkey from extension')
      }
      const readOnlyDup = storage
        .getAccounts()
        .find((a) => a.pubkey === extPubkey && a.signerType === 'npub')
      if (readOnlyDup) {
        storage.removeAccount(readOnlyDup)
        syncAccountPointersFromStorage()
      }
      const existing = storage
        .getAccounts()
        .find((a) => a.pubkey === extPubkey && a.signerType === 'nip-07')
      const act: TAccount = existing ?? { pubkey: extPubkey, signerType: 'nip-07' }
      flushSync(() => login(nip07Signer, act))
      setAccountNetworkHydrateBump((n) => n + 1)
      toast.success(t('nip07.switchedToExtensionIdentity'))
    } catch (e) {
      toast.error(`${t('nip07.adoptExtensionFailed')}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  /**
   * User chose read-only browse, but the extension may already match — promote quietly.
   */
  useEffect(() => {
    if (!account || account.signerType !== 'npub') return
    const intentionalPk = intentionalNip07ReadOnlyPubkeyRef.current
    const sessionPk = accountPubkeyToHex(account.pubkey)
    if (!intentionalPk || !sessionPk || !hexPubkeysEqual(sessionPk, intentionalPk)) {
      return
    }

    let cancelled = false
    let promotionStopped = false
    const tryPromote = async () => {
      if (promotionStopped) return
      const nip07Row = storage
        .getAccounts()
        .find(
          (a) => a.signerType === 'nip-07' && hexPubkeysEqual(a.pubkey, intentionalPk)
        )
      if (!nip07Row) return
      try {
        if (cancelled) return
        const ok = await reconnectNip07ForPubkey(intentionalPk, nip07Row)
        if (ok) {
          logger.info('[NostrProvider] Promoted intentional read-only session to NIP-07', {
            pubkeySlice: intentionalPk.slice(0, 12)
          })
          promotionStopped = true
        } else {
          // Extension key differs — stay read-only; avoid reconnect spam in the console.
          promotionStopped = true
        }
      } catch {
        // Extension not ready — stay read-only until the user switches account.
        promotionStopped = true
      }
    }

    void tryPromote()
    const id = window.setInterval(() => {
      if (promotionStopped) {
        window.clearInterval(id)
        return
      }
      void tryPromote()
    }, 2_500)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  useEffect(() => {
    if (!account || account.signerType !== 'npub') return
    const intentionalPk = intentionalNip07ReadOnlyPubkeyRef.current
    if (intentionalPk) return
    const sessionPk = accountPubkeyToHex(account.pubkey)
    if (!sessionPk) return
    const preferred = storage.getCurrentAccount()
    const recoverPk =
      preferred && hexPubkeysEqual(preferred.pubkey, sessionPk)
        ? accountPubkeyToHex(preferred.pubkey)
        : sessionPk
    if (!recoverPk) return
    const nip07Row = storage
      .getAccounts()
      .find((a) => a.signerType === 'nip-07' && hexPubkeysEqual(a.pubkey, recoverPk))
    if (!nip07Row) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    const maxAttempts = 10

    const schedule = (ms: number) => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void tryRecover()
      }, ms)
    }

    const tryRecover = async () => {
      if (cancelled || attempts >= maxAttempts) return
      attempts += 1
      try {
        const ok = await reconnectNip07ForPubkey(recoverPk, nip07Row)
        if (ok) {
          logger.info('[NostrProvider] Recovered NIP-07 signer from read-only fallback', {
            pubkeySlice: recoverPk.slice(0, 12),
            attempts
          })
          return
        }
        throw new Error(NIP07_SIGNER_PUBKEY_MISMATCH_MSG)
      } catch (error) {
        if (isNip07SignerPubkeyMismatchError(error)) {
          logger.info('[NostrProvider] NIP-07 recovery: extension key mismatch on attempt', {
            attempts,
            wantedPubkey: recoverPk.slice(0, 12)
          })
          return
        }
        logger.info('[NostrProvider] NIP-07 recovery retry failed', {
          pubkeySlice: recoverPk.slice(0, 12),
          attempts,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      schedule(Math.min(10_000, attempts * 1_500))
    }

    schedule(1_200)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // nip07RecoveryBump is incremented by switchAccount after it updates storage following an
    // npub fallback, so the loop re-fires with the correct preferred account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, nip07RecoveryBump])

  const normalizeDraftEventTags = (
    draftEvent: TDraftEvent,
    options?: { addClientTag?: boolean }
  ): TDraftEvent => applyImwaldAttributionTags(draftEvent, options)

  const signEvent = async (
    draftEvent: TDraftEvent,
    normalizeOpts?: { addClientTag?: boolean }
  ) => {
    const normalizedDraft = normalizeDraftEventTags(draftEvent, normalizeOpts)

    if (isAnonAccount(account)) {
      const ephemeral = createEphemeralSigner()
      const event = await ephemeral.signEvent(normalizedDraft)
      if (!validateEvent(event)) {
        throw new Error('Event validation failed - invalid signature or format.')
      }
      return event as VerifiedEvent
    }

    // Add timeout to prevent hanging
    const signEventWithTimeout = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Signing request timed out. Your Nostr extension may be waiting for authorization. Try closing this tab and restarting your browser to surface any pending authorization requests from your extension.'))
      }, 30000) // 30 second timeout
      
      signer?.signEvent(normalizedDraft)
        .then((event) => {
          clearTimeout(timeout)
          resolve(event)
        })
        .catch((error) => {
          clearTimeout(timeout)
          reject(error)
        })
    })
    
    const event = await signEventWithTimeout as VerifiedEvent
    if (!event) {
      throw new Error('sign event failed')
    }
    if (!validateEvent(event)) {
      throw new Error('Event validation failed - invalid signature or format. Please try logging in again.')
    }
    return event as VerifiedEvent
  }

  const publishExtensionMismatchError = () =>
    new Error(
      t('nip07.publishExtensionMismatch', {
        defaultValue:
          'Your extension signed with a different key than the selected account. Switch the key in the extension or use “Retry extension” in the composer.'
      })
    )

  const assertSignerMatchesAccountForPublish = async () => {
    if (!account || !signer || account.signerType === 'npub') return
    const accountPk = accountPubkeyToHex(account.pubkey)
    if (!accountPk) throw new LoginRequiredError()
    if (account.signerType !== 'nip-07') return
    let signerPk: string | null = null
    try {
      signerPk = pubkeyFromNip07Extension(await signer.getPublicKey())
    } catch {
      return
    }
    if (signerPk && !hexPubkeysEqual(signerPk, accountPk)) {
      throw publishExtensionMismatchError()
    }
  }

  const publish = async (
    draftEvent: TDraftEvent,
    { minPow = 0, ...options }: TPublishOptions = {}
  ) => {
    if (!account || account.signerType === 'npub') {
      throw new LoginRequiredError()
    }
    if (!isAnonAccount(account) && !signer) {
      throw new LoginRequiredError()
    }

    const anonSigner = isAnonAccount(account) ? createEphemeralSigner() : null
    const activeSigner = anonSigner ?? signer
    if (!activeSigner) {
      throw new LoginRequiredError()
    }

    const accountPk = isAnonAccount(account) ? null : accountPubkeyToHex(account.pubkey)
    if (!isAnonAccount(account)) {
      await assertSignerMatchesAccountForPublish()
    }

    const normalizeOpts = { addClientTag: options.addClientTag }
    const draft = normalizeDraftEventTags(draftEvent, normalizeOpts)
    let event: Event
    if (isUnsignedExperimentalKind(draft.kind)) {
      if (minPow > 0) {
        throw new Error(
          t('Proof of work is not supported for unsigned experimental kinds ({{min}}–{{max}}).', {
            min: UNSIGNED_EXPERIMENTAL_KIND_MIN,
            max: UNSIGNED_EXPERIMENTAL_KIND_MAX
          })
        )
      }
      const publishPubkey = anonSigner ? await anonSigner.getPublicKey() : account.pubkey
      const unsignedTemplate = {
        kind: draft.kind,
        content: draft.content,
        tags: draft.tags,
        created_at: draft.created_at,
        pubkey: publishPubkey
      }
      if (!validateEvent(unsignedTemplate)) {
        throw new Error(t('Invalid event fields'))
      }
      const id = getEventHash(unsignedTemplate)
      event = { ...unsignedTemplate, id, sig: '' }
    } else if (minPow > 0) {
      const publishPubkey = anonSigner ? await anonSigner.getPublicKey() : account.pubkey
      const unsignedEvent = await minePow({ ...draft, pubkey: publishPubkey }, minPow)
      const normalizedUnsigned = normalizeDraftEventTags(unsignedEvent, normalizeOpts)
      event = await activeSigner.signEvent(normalizedUnsigned)
      if (!validateEvent(event)) {
        throw new Error('Event validation failed - invalid signature or format.')
      }
    } else {
      const normalizedDraft = normalizeDraftEventTags(draft, normalizeOpts)
      event = await activeSigner.signEvent(normalizedDraft)
      if (!validateEvent(event)) {
        throw new Error('Event validation failed - invalid signature or format.')
      }
    }

    if (
      !isAnonAccount(account) &&
      event.kind !== kinds.Application &&
      accountPk &&
      !hexPubkeysEqual(event.pubkey, accountPk)
    ) {
      throw publishExtensionMismatchError()
    }

    client.interruptBackgroundQueries()
    noteStatsService.beginPublishPriority()
    let publishRelayCandidates: string[] = []
    const publishTrace = options.publishTrace
    try {
      if (event.kind === kinds.EventDeletion) {
        const tombstoneKeys = await client.applyDeletionRequestToLocalCache(event)
        noteStatsService.dropTombstonedReplies(tombstoneKeys)
      }
      publishTrace?.step('sign event done', { eventId: event.id?.slice(0, 12), kind: event.kind })
      logger.debug('[Publish] Determining target relays...', { kind: event.kind, pubkey: event.pubkey?.substring(0, 8) })
      publishTrace?.step('determineTargetRelays')
      const favoriteRelayUrls = favoriteRelayUrlsForPublish(
        favoriteRelaysEvent,
        account.pubkey,
        relayList,
        account
      )
      publishRelayCandidates = await client.determineTargetRelays(event, {
        ...options,
        favoriteRelayUrls,
        blockedRelayUrls: options.blockedRelayUrls ?? blockedRelayUrlsFromEvent(blockedRelaysEvent),
        viewerRelayList: relayList
      })
      const relays = publishRelayCandidates
      publishTrace?.step('determineTargetRelays done', {
        relayCount: relays.length,
        relays: relays.slice(0, 6).map((u) => {
          try {
            return new URL(u).host
          } catch {
            return u.slice(0, 40)
          }
        })
      })
      logger.debug('[Publish] Target relays determined', { relayCount: relays.length, relays: relays.slice(0, 5) })

      logger.debug('[Publish] Calling client.publishEvent()...', { relayCount: relays.length, eventId: event.id?.substring(0, 8) })
      publishTrace?.step('publishEvent', { relayCount: relays.length })
      const publishExtras = {
        favoriteRelayUrls,
        /** Picker / `specifiedRelayUrls` is the authoritative target list — do not prepend full NIP-65 outbox again. */
        skipOutboxRetry: (options.specifiedRelayUrls?.length ?? 0) > 0,
        /** Explicitly-selected relays are always attempted, even if read-only / parked (admin can write). */
        forceRelayUrls: options.specifiedRelayUrls,
        publishTrace
      }
      const publishResult = await client.publishEvent(relays, event, publishExtras)
      publishTrace?.step('publishEvent returned', {
        successCount: publishResult.successCount,
        totalCount: publishResult.totalCount
      })
      
      // Store relay status temporarily for display (but don't persist it on the event)
      // This metadata is only for logging/feedback, not part of the actual event
      const relayStatuses = publishResult.relayStatuses.length > 0 ? publishResult.relayStatuses : undefined
      
      // If at least one relay accepted, cache and emit immediately so UI shows the event without waiting
      if (publishResult.successCount >= 1) {
        client.addEventToCache(event)
        // Calendar RSVPs: durable store before `newEvent` so hooks that re-read IDB see this row first.
        if (event.kind === ExtendedKind.CALENDAR_EVENT_RSVP) {
          try {
            await indexedDb.putCalendarRsvpEventRow(event)
          } catch (err) {
            logger.warn('[Publish] Calendar RSVP IndexedDB persist failed', { err })
          }
        }
        if (event.kind === ExtendedKind.PAYMENT_NOTIFICATION) {
          try {
            await indexedDb.putPaymentNotificationRow(event)
          } catch (err) {
            logger.warn('[Publish] Payment notification IndexedDB persist failed', { err })
          }
        }
        if (event.kind === ExtendedKind.PAYMENT_ATTESTATION) {
          try {
            await indexedDb.putPaymentAttestationRow(event)
          } catch (err) {
            logger.warn('[Publish] Payment attestation IndexedDB persist failed', { err })
          }
        }
        client.emitNewEvent(event)
        // Replaceable list events (pins, cache relays, …) must hit IndexedDB + DataLoader, not only RAM
        void replaceableEventService.updateReplaceableEventCache(event).catch(() => {})
      }

      // Replaceable events and notes: cache above uses successCount >= 1. publishEvent still sets
      // success only when >=1/3 of relays OK (broad replication). Treat "zero accepts" as failure
      // so we don't throw when a few relays worked but many timed out (common with large outbox lists).
      if (publishResult.successCount < 1) {
        logger.error('[Publish] Publishing failed on every relay', {
          eventKind: event.kind,
          eventId: event.id?.substring(0, 8),
          relayStatuses: publishResult.relayStatuses,
          failedUrls: publishResult.relayStatuses.filter((s) => !s.success).map((s) => s.url)
        })
        const error = new AggregateError(
          publishResult.relayStatuses
            .filter(s => !s.success)
            .map(s => new Error(s.error || 'Failed')),
          'Failed to publish to any relay'
        )
        ;(error as any).relayStatuses = publishResult.relayStatuses
        throw error
      }
      if (!publishResult.success) {
        logger.warn('[Publish] Partial publish: some relays failed or timed out', {
          eventKind: event.kind,
          eventId: event.id?.substring(0, 8),
          successCount: publishResult.successCount,
          totalCount: publishResult.totalCount
        })
      }

      logger.debug('[Publish] Publishing successful, attaching relayStatuses to event')
      // Attach relayStatuses only temporarily for UI feedback, then remove it
      if (relayStatuses) {
        (event as any).relayStatuses = relayStatuses
        setTimeout(() => {
          delete (event as any).relayStatuses
        }, 100)
      }
      // Cache and emit already done above when successCount >= 1
      logger.debug('[Publish] Returning event', { eventId: event.id?.substring(0, 8), hasRelayStatuses: !!relayStatuses })
      return event
    } catch (error) {
      // Check for authentication-related errors
      if (error instanceof AggregateError && (error as any).relayStatuses) {
        // Attach relayStatuses temporarily for UI feedback
        const errorRelayStatuses = (error as any).relayStatuses as Array<{ url: string; success: boolean; error?: string }>
        
        // Attach to event temporarily for UI feedback
        (event as any).relayStatuses = errorRelayStatuses
        
        // Remove it after a brief delay to allow UI components to read it
        setTimeout(() => {
          delete (event as any).relayStatuses
        }, 100)
        
        // Check if any relay returned an "invalid key" error
        const invalidKeyErrors = errorRelayStatuses.filter(
          (status) => status.error && status.error.includes('invalid key')
        )
        
        if (invalidKeyErrors.length > 0) {
          throw new Error('Authentication failed - invalid key. Please try logging out and logging in again.')
        }
      }
      
      // Re-throw the error so the UI can handle it appropriately
      throw error
    } finally {
      noteStatsService.endPublishPriority()
      client.closePublishTransientRelays(publishRelayCandidates)
    }
  }

  const attemptDelete = async (targetEvent: Event) => {
    if (!account || account.signerType === 'npub') {
      return
    }
    if (isAnonAccount(account)) {
      throw new Error(t('accountSwitch.anonCannotDelete'))
    }
    if (!signer) {
      return
    }
    if (account.pubkey !== targetEvent.pubkey) {
      throw new Error(t('You can only delete your own notes'))
    }

    const deletionRequest = await signEvent(createDeletionRequestDraftEvent(targetEvent))

    const tombstoneKeys = await client.applyDeletionRequestToLocalCache(deletionRequest, targetEvent)
    noteStatsService.dropTombstonedReplies(tombstoneKeys)

    client.interruptBackgroundQueries()

    // Privacy: Only use user's own relays, never connect to "seen on" relays
    const favUrls = favoriteRelayUrlsForPublish(
      favoriteRelaysEvent,
      account?.pubkey ?? null,
      relayList,
      account
    )
    const relays = await client.determineTargetRelays(targetEvent, {
      favoriteRelayUrls: favUrls,
      blockedRelayUrls: blockedRelayUrlsFromEvent(blockedRelaysEvent)
    })

    const result = await client.publishEvent(relays, deletionRequest, { favoriteRelayUrls: favUrls })

    // Show publishing feedback
    if (result.relayStatuses) {
      showPublishingFeedback(result, {
        message: t('Deletion request sent'),
        duration: 6000
      })
    } else {
      showSimplePublishSuccess(t('Deletion request sent'))
    }
  }

  const signHttpAuth = async (url: string, method: string, content = '') => {
    const event = await signEvent({
      content,
      kind: kinds.HTTPAuth,
      created_at: dayjs().unix(),
      tags: [
        ['u', url],
        ['method', method]
      ]
    })
    return 'Nostr ' + btoa(JSON.stringify(event))
  }

  const nip04Encrypt = async (pubkey: string, plainText: string) => {
    if (isAnonAccount(account)) {
      return createEphemeralSigner().nip04Encrypt(pubkey, plainText)
    }
    return signer?.nip04Encrypt(pubkey, plainText) ?? ''
  }

  const nip04Decrypt = async (pubkey: string, cipherText: string) => {
    if (isAnonAccount(account)) {
      try {
        return (await createEphemeralSigner().nip04Decrypt(pubkey, cipherText)) ?? ''
      } catch {
        return ''
      }
    }
    if (!signer) return ''
    try {
      return (await signer.nip04Decrypt(pubkey, cipherText)) ?? ''
    } catch {
      // Extensions often throw (padding / wrong key) while nsec path returns ''; keep call sites simple.
      return ''
    }
  }

  const checkLogin = async <T,>(cb?: () => T | Promise<T>): Promise<T | void> => {
    if (account?.signerType === 'npub') {
      if (cb) {
        toast.error(t('readOnlySession.cannotPublish'))
      }
      return
    }
    if (isAnonAccount(account)) {
      if (cb) return await cb()
      return
    }
    if (!signer) {
      setOpenLoginDialog(true)
      return
    }
    if (cb) {
      return await cb()
    }
  }

  const updateRelayListEvent = async (relayListEvent: Event) => {
    await indexedDb.putReplaceableEvent(relayListEvent)
    // Clear the relay list cache to force a fresh fetch
    if (account?.pubkey) {
      client.clearRelayListCache(account.pubkey)
    }
    // Fetch updated relay list (which merges both 10002 and 10432)
    const mergedRelayList = await client.fetchRelayList(account?.pubkey || '')
    setRelayList(mergedRelayList)
  }

  const updateCacheRelayListEvent = async (cacheRelayListEvent: Event) => {
    await indexedDb.putReplaceableEvent(cacheRelayListEvent)
    // Clear the relay list cache to ensure fresh fetches use the updated event
    if (account?.pubkey) {
      client.clearRelayListCache(account.pubkey)
    }
    // Set local state immediately with the event we just saved
    // This will trigger the component's useEffect to update the UI immediately
    setCacheRelayListEvent(cacheRelayListEvent)
    bindLightArchiveCacheRelayUrls(
      storage.getCacheRelaysEnabled() ? getCacheRelayUrlsFromEvent(cacheRelayListEvent) : []
    )
    void client.applyNotePersistencePolicyChange()
    // Don't update relayList here - it's a computed merge of kind 10002 + 10432
    // The merged list will be computed on-the-fly when needed via fetchRelayList()
    // This ensures kind 10002 and 10432 remain separate and are only merged when publishing/using
  }

  const setCacheRelaysEnabled = async (enabled: boolean) => {
    storage.setCacheRelaysEnabled(enabled)
    setCacheRelaysEnabledState(enabled)
    bindLightArchiveCacheRelayUrls(
      enabled ? getCacheRelayUrlsFromEvent(cacheRelayListEvent) : []
    )
    await client.applyNotePersistencePolicyChange()
    const pk = account?.pubkey
    if (!pk) return
    client.clearRelayListCache(pk)
    await client.syncViewerPersonalRelayKeys(pk)
    const mergedRelayList = await client.peekRelayListFromStorage(pk)
    setRelayList(mergedRelayList)
  }

  const updateHttpRelayListEvent = async (httpRelayEvent: Event) => {
    await indexedDb.putReplaceableEvent(httpRelayEvent)
    if (account?.pubkey) {
      client.clearRelayListCache(account.pubkey)
      await client.syncViewerPersonalRelayKeys(account.pubkey)
    }
    setHttpRelayListEvent(httpRelayEvent)
    const mergedRelayList = await client.fetchRelayList(account?.pubkey || '')
    setRelayList(mergedRelayList)
  }

  const updateProfileEvent = async (profileEvent: Event) => {
    try {
      await indexedDb.putReplaceableEvent(profileEvent)
    } catch (e) {
      logger.warn('[NostrProvider] updateProfileEvent: putReplaceableEvent failed', { error: e })
    }
    void replaceableEventService.updateReplaceableEventCache(profileEvent).catch(() => {})
    // Always apply the just-published event to state regardless of IDB's newer-wins result,
    // so the UI is never left showing a stale event that IDB preferred over what we just saved.
    setProfileEvent(profileEvent)
    setProfile(getProfileFromEvent(profileEvent))
  }

  const updateFollowListEvent = async (followListEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(followListEvent)
    /** Always sync follow list state/cache to the IndexedDB winner. */
    setFollowListEvent(stored)
    await client.updateFollowListCache(stored)
  }

  const updateMuteListEvent = async (muteListEvent: Event, privateTags: string[][]) => {
    const storedWinner = await indexedDb.putReplaceableEvent(muteListEvent)
    if (storedWinner.id === muteListEvent.id) {
      await indexedDb.putMuteDecryptedTags(muteListEvent.id, privateTags)
      setMuteListEvent(muteListEvent)
      return
    }
    // IndexedDB kept a different replaceable winner (e.g. higher created_at). Sync UI to storage
    // so feeds do not keep showing notes that should be hidden while state still pointed at the losing event.
    setMuteListEvent(storedWinner)
  }

  const updateBookmarkListEvent = async (bookmarkListEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(bookmarkListEvent)
    /** Keep bookmark UI aligned with replaceable winner from storage. */
    setBookmarkListEvent(stored)
  }

  const updateInterestListEvent = async (interestListEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(interestListEvent)
    /** Keep interests UI aligned with replaceable winner from storage. */
    setInterestListEvent(stored)
  }

  const updateUserEmojiListEvent = async (ev: Event) => {
    try {
      await indexedDb.putReplaceableEvent(ev)
    } catch (e) {
      logger.warn('[NostrProvider] updateUserEmojiListEvent: putReplaceableEvent failed', { error: e })
    }
    void replaceableEventService.updateReplaceableEventCache(ev).catch(() => {})
    /** Same as profile: keep the event we just published in UI even if IDB keeps an older winner for the coordinate. */
    setUserEmojiListEvent(ev)
  }

  const updateFavoriteRelaysEvent = async (favoriteRelaysEvent: Event) => {
    const stored = await indexedDb.putReplaceableEvent(favoriteRelaysEvent)
    /** Prefer the event we just published; only keep IDB row when it is strictly newer. */
    setFavoriteRelaysEvent(
      stored.created_at > favoriteRelaysEvent.created_at ? stored : favoriteRelaysEvent
    )
  }

  const persistNewUserTemplateLocally = async (
    signer: ISigner,
    pubkey: string
  ): Promise<Record<keyof TNewUserTemplateDrafts, VerifiedEvent>> => {
    if (newUserSetupInFlightRef.current.has(pubkey)) {
      throw new Error('New user setup already in progress')
    }
    newUserSetupInFlightRef.current.add(pubkey)

    try {
      const drafts = buildNewUserTemplateDrafts(pubkey)
      const signDraft = async (draft: TDraftEvent) => {
        const event = await signer.signEvent(normalizeDraftEventTags(draft))
        if (!validateEvent(event)) {
          throw new Error('Event validation failed')
        }
        return event as VerifiedEvent
      }

      const signed = {
        profile: await signDraft(drafts.profile),
        favoriteRelays: await signDraft(drafts.favoriteRelays),
        blockedRelays: await signDraft(drafts.blockedRelays),
        relayList: await signDraft(drafts.relayList),
        httpRelayList: await signDraft(drafts.httpRelayList),
        interestList: await signDraft(drafts.interestList),
        followList: await signDraft(drafts.followList),
        muteList: await signDraft(drafts.muteList)
      }

      await Promise.all([
        indexedDb.putReplaceableEvent(signed.profile),
        indexedDb.putReplaceableEvent(signed.favoriteRelays),
        indexedDb.putReplaceableEvent(signed.blockedRelays),
        indexedDb.putReplaceableEvent(signed.relayList),
        indexedDb.putReplaceableEvent(signed.httpRelayList),
        indexedDb.putReplaceableEvent(signed.interestList),
        indexedDb.putReplaceableEvent(signed.followList),
        indexedDb.putReplaceableEvent(signed.muteList)
      ])

      const blockedUrls = blockedRelayUrlsFromEvent(signed.blockedRelays)
      setViewerBlockedRelayUrls(blockedUrls)
      setBlockedRelaysEvent(signed.blockedRelays)

      client.updateRelayListCache(signed.relayList)
      void client.updateFollowListCache(signed.followList).catch(() => {})
      void replaceableEventService.updateReplaceableEventCache(signed.profile).catch(() => {})

      return signed
    } catch (error) {
      clearFreshSignupSkipNetworkHydrate(pubkey)
      logger.error('[setupNewUser] local persist failed', { error })
      throw error
    } finally {
      newUserSetupInFlightRef.current.delete(pubkey)
    }
  }

  const updateBlockedRelaysEvent = async (blockedRelaysEvent: Event) => {
    const newBlockedRelaysEvent = await indexedDb.putReplaceableEvent(blockedRelaysEvent)
    if (newBlockedRelaysEvent.id !== blockedRelaysEvent.id) return

    setBlockedRelaysEvent(newBlockedRelaysEvent)
  }

  const requestAccountNetworkHydrate = useCallback(() => {
    if (!account) return Promise.resolve()
    forceNextAccountNetworkHydrateRef.current = true
    return new Promise<void>((resolve) => {
      manualNetworkHydrateResolveRef.current = resolve
      setAccountNetworkHydrateBump((n) => n + 1)
    })
  }, [account])

  const startLogin = useCallback(() => {
    if (account?.signerType === 'npub') return
    setOpenLoginDialog(true)
  }, [account?.signerType])

  const removeAccountStable = useEventCallback(removeAccount)
  const discardLocalPrivateKeyStable = useEventCallback(discardLocalPrivateKey)
  const switchAccountStable = useEventCallback(switchAccount)
  const viewAccountAsReadOnlyStable = useEventCallback(viewAccountAsReadOnly)
  const retryNip07SignerForPreferredAccountStable = useEventCallback(retryNip07SignerForPreferredAccount)
  const adoptExtensionNip07IdentityStable = useEventCallback(adoptCurrentExtensionNip07Identity)
  const nsecLoginStable = useEventCallback(nsecLogin)
  const ncryptsecLoginStable = useEventCallback(ncryptsecLogin)
  const npubLoginStable = useEventCallback(npubLogin)
  const nip07LoginStable = useEventCallback(nip07Login)
  const bunkerLoginStable = useEventCallback(bunkerLogin)
  const nostrConnectionLoginStable = useEventCallback(nostrConnectionLogin)
  const publishStable = useEventCallback(publish)
  const attemptDeleteStable = useEventCallback(attemptDelete)
  const signHttpAuthStable = useEventCallback(signHttpAuth)
  const nip04EncryptStable = useEventCallback(nip04Encrypt)
  const nip04DecryptStable = useEventCallback(nip04Decrypt)
  const checkLoginStable = useEventCallback(checkLogin)
  const signEventStable = useEventCallback(signEvent)
  const updateRelayListEventStable = useEventCallback(updateRelayListEvent)
  const updateCacheRelayListEventStable = useEventCallback(updateCacheRelayListEvent)
  const setCacheRelaysEnabledStable = useEventCallback(setCacheRelaysEnabled)
  const updateHttpRelayListEventStable = useEventCallback(updateHttpRelayListEvent)
  const updateProfileEventStable = useEventCallback(updateProfileEvent)
  const updateFollowListEventStable = useEventCallback(updateFollowListEvent)
  const updateMuteListEventStable = useEventCallback(updateMuteListEvent)
  const updateBookmarkListEventStable = useEventCallback(updateBookmarkListEvent)
  const updateInterestListEventStable = useEventCallback(updateInterestListEvent)
  const updateUserEmojiListEventStable = useEventCallback(updateUserEmojiListEvent)
  const updateFavoriteRelaysEventStable = useEventCallback(updateFavoriteRelaysEvent)
  const updateBlockedRelaysEventStable = useEventCallback(updateBlockedRelaysEvent)

  const nostrContextValue = useMemo(
    (): TNostrContext => ({
      isInitialized,
      isAccountSessionHydrating,
      isNip07LoginInFlight,
      pubkey: isAnonAccount(account) ? null : (account?.pubkey ?? null),
      profile,
      profileEvent,
      relayList,
      cacheRelayListEvent,
      cacheRelaysEnabled,
      httpRelayListEvent,
      followListEvent,
      muteListEvent,
      bookmarkListEvent,
      interestListEvent,
      favoriteRelaysEvent,
      blockedRelaysEvent,
      userEmojiListEvent,
      account,
      accounts,
      canSignEvents: canAccountSignEvents(account),
      isAnonSession: isAnonAccount(account),
      canManageIdentity: canManageIdentityFeatures(account),
      nsec,
      ncryptsec,
      switchAccount: switchAccountStable,
      viewAccountAsReadOnly: viewAccountAsReadOnlyStable,
      retryNip07SignerForPreferredAccount: retryNip07SignerForPreferredAccountStable,
      adoptExtensionNip07Identity: adoptExtensionNip07IdentityStable,
      nsecLogin: nsecLoginStable,
      ncryptsecLogin: ncryptsecLoginStable,
      nip07Login: nip07LoginStable,
      bunkerLogin: bunkerLoginStable,
      nostrConnectionLogin: nostrConnectionLoginStable,
      npubLogin: npubLoginStable,
      removeAccount: removeAccountStable,
      discardLocalPrivateKey: discardLocalPrivateKeyStable,
      publish: publishStable,
      attemptDelete: attemptDeleteStable,
      signHttpAuth: signHttpAuthStable,
      nip04Encrypt: nip04EncryptStable,
      nip04Decrypt: nip04DecryptStable,
      startLogin,
      checkLogin: checkLoginStable,
      signEvent: signEventStable,
      updateRelayListEvent: updateRelayListEventStable,
      updateCacheRelayListEvent: updateCacheRelayListEventStable,
      setCacheRelaysEnabled: setCacheRelaysEnabledStable,
      updateHttpRelayListEvent: updateHttpRelayListEventStable,
      updateProfileEvent: updateProfileEventStable,
      updateFollowListEvent: updateFollowListEventStable,
      updateMuteListEvent: updateMuteListEventStable,
      updateBookmarkListEvent: updateBookmarkListEventStable,
      updateInterestListEvent: updateInterestListEventStable,
      updateUserEmojiListEvent: updateUserEmojiListEventStable,
      updateFavoriteRelaysEvent: updateFavoriteRelaysEventStable,
      updateBlockedRelaysEvent: updateBlockedRelaysEventStable,
      requestAccountNetworkHydrate
    }),
    [
      isInitialized,
      isAccountSessionHydrating,
      isNip07LoginInFlight,
      account,
      accounts,
      attemptDeleteStable,
      blockedRelaysEvent,
      bookmarkListEvent,
      bunkerLoginStable,
      cacheRelayListEvent,
      cacheRelaysEnabled,
      checkLoginStable,
      favoriteRelaysEvent,
      followListEvent,
      httpRelayListEvent,
      interestListEvent,
      muteListEvent,
      ncryptsec,
      ncryptsecLoginStable,
      nip04DecryptStable,
      nip04EncryptStable,
      nip07LoginStable,
      nostrConnectionLoginStable,
      npubLoginStable,
      nsec,
      nsecLoginStable,
      profile,
      profileEvent,
      publishStable,
      relayList,
      discardLocalPrivateKeyStable,
      removeAccountStable,
      requestAccountNetworkHydrate,
      signEventStable,
      signHttpAuthStable,
      startLogin,
      switchAccountStable,
      viewAccountAsReadOnlyStable,
      retryNip07SignerForPreferredAccountStable,
      adoptExtensionNip07IdentityStable,
      updateBlockedRelaysEventStable,
      updateBookmarkListEventStable,
      updateCacheRelayListEventStable,
      setCacheRelaysEnabledStable,
      updateFavoriteRelaysEventStable,
      updateFollowListEventStable,
      updateHttpRelayListEventStable,
      updateInterestListEventStable,
      updateMuteListEventStable,
      updateProfileEventStable,
      updateRelayListEventStable,
      updateUserEmojiListEventStable,
      userEmojiListEvent
    ]
  )

  return (
    <NostrContext.Provider value={nostrContextValue}>
      {children}
      <LoginDialog
        open={openLoginDialog}
        setOpen={setOpenLoginDialog}
        blockClose={isNip07LoginInFlight}
      />
      <NcryptsecPasswordPrompt open={ncryptsecPasswordOpen} onResult={finishNcryptsecPasswordPrompt} />
    </NostrContext.Provider>
  )
}
