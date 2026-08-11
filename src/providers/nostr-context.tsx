/**
 * Standalone React context for Nostr so HMR on `NostrProvider/index.tsx` does not recreate
 * `createContext()` (which breaks `useNostr` in providers like InterestListProvider after Fast Refresh).
 */
import type {
  TAccountPointer,
  TDraftEvent,
  TProfile,
  TPublishOptions,
  TRelayList
} from '@/types'
import { Event, VerifiedEvent } from 'nostr-tools'
import { createContext, useContext } from 'react'

export type TNostrContext = {
  isInitialized: boolean
  /** True while replaceable events + relay list are loading from cache/relays after login or account switch. */
  isAccountSessionHydrating: boolean
  pubkey: string | null
  profile: TProfile | null
  profileEvent: Event | null
  relayList: TRelayList | null
  cacheRelayListEvent: Event | null
  /** Device-local: when false, kind 10432 cache relays are not contacted on this machine. */
  cacheRelaysEnabled: boolean
  setCacheRelaysEnabled: (enabled: boolean) => Promise<void>
  /** Kind 10243 (HTTPS index relays); null if none, undefined while not loaded. */
  httpRelayListEvent: Event | null | undefined
  followListEvent: Event | null
  muteListEvent: Event | null
  bookmarkListEvent: Event | null
  interestListEvent: Event | null
  favoriteRelaysEvent: Event | null
  blockedRelaysEvent: Event | null
  userEmojiListEvent: Event | null
  account: TAccountPointer | null
  accounts: TAccountPointer[]
  nsec: string | null
  ncryptsec: string | null
  /** True when the session can sign (not read-only npub fallback). */
  canSignEvents: boolean
  /** Anonymous write session: fresh key per publish/sign/auth. */
  isAnonSession: boolean
  /** Stable identity features (profile, follow, mute, lists). False in anon write mode. */
  canManageIdentity: boolean
  /** Returns the new session pubkey on success, or `null` if logout / switch failed. */
  switchAccount: (account: TAccountPointer | null) => Promise<string | null>
  /** View an account read-only (notifications, relays) without matching the browser extension. */
  viewAccountAsReadOnly: (account: TAccountPointer) => Promise<string | null>
  /** Reconnect NIP-07 when the extension pubkey matches the stored preferred account. */
  retryNip07SignerForPreferredAccount: () => Promise<boolean>
  /** Sign in with whichever pubkey the browser extension exposes now. */
  adoptExtensionNip07Identity: () => Promise<void>
  /** True while the login modal must stay open for an in-flight NIP-07 authorize. */
  isNip07LoginInFlight: boolean
  nsecLogin: (nsec: string, password?: string, needSetup?: boolean) => Promise<string>
  ncryptsecLogin: (ncryptsec: string) => Promise<string>
  nip07Login: () => Promise<string | null>
  bunkerLogin: (bunker: string, options?: { allowMissingSecret?: boolean }) => Promise<string>
  nostrConnectionLogin: (
    clientSecretKey: Uint8Array,
    connectionString: string,
    abortSignal?: AbortSignal
  ) => Promise<string>
  npubLogin(npub: string): Promise<string>
  removeAccount: (account: TAccountPointer) => void
  /** Remove locally stored nsec/ncryptsec; account becomes read-only npub until remote login. */
  discardLocalPrivateKey: () => void
  publish: (draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<Event>
  attemptDelete: (targetEvent: Event) => Promise<void>
  signHttpAuth: (url: string, method: string) => Promise<string>
  signEvent: (draftEvent: TDraftEvent) => Promise<VerifiedEvent>
  nip04Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip04Decrypt: (pubkey: string, cipherText: string) => Promise<string>
  nip44Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip44Decrypt: (pubkey: string, cipherText: string) => Promise<string>
  startLogin: () => void
  checkLogin: <T>(cb?: () => T | Promise<T>) => Promise<T | void>
  updateRelayListEvent: (relayListEvent: Event) => Promise<void>
  updateCacheRelayListEvent: (cacheRelayListEvent: Event) => Promise<void>
  updateHttpRelayListEvent: (httpRelayListEvent: Event) => Promise<void>
  updateProfileEvent: (profileEvent: Event) => Promise<void>
  updateFollowListEvent: (followListEvent: Event) => Promise<void>
  updateMuteListEvent: (muteListEvent: Event, privateTags: string[][]) => Promise<void>
  updateBookmarkListEvent: (bookmarkListEvent: Event) => Promise<void>
  updateInterestListEvent: (interestListEvent: Event) => Promise<void>
  updateFavoriteRelaysEvent: (favoriteRelaysEvent: Event) => Promise<void>
  updateBlockedRelaysEvent: (blockedRelaysEvent: Event) => Promise<void>
  updateUserEmojiListEvent: (userEmojiListEvent: Event) => Promise<void>
  /**
   * Re-run the full account network hydrate (relay lists + replaceable merge + prewarm), bypassing the
   * 24h throttle. Resolves when the hydrate pass finishes. No-op when logged out.
   */
  requestAccountNetworkHydrate: () => Promise<void>
}

export const NostrContext = createContext<TNostrContext | undefined>(undefined)

export function useNostr(): TNostrContext {
  const context = useContext(NostrContext)
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider')
  }
  return context
}

/** Returns undefined when outside NostrProvider (e.g. embedded notes in createRoot trees). */
export function useNostrOptional(): TNostrContext | undefined {
  return useContext(NostrContext)
}
