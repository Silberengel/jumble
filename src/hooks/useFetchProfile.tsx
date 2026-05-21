import { FEED_PROFILE_PENDING_BATCH_ESCAPE_MS, PROFILE_FETCH_PROMISE_TIMEOUT_MS } from '@/constants'
import { shouldDropEventOnIngest } from '@/lib/event-ingest-filter'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { getSeededProfileForNavigation } from '@/lib/profile-navigation-seed'
import {
  isPubkeyAwaitingProfileBatch,
  shouldDeferPerPubkeyProfileNetwork
} from '@/lib/profile-batch-coordinator'
import { normalizeHexPubkey, userIdToPubkey } from '@/lib/pubkey'
import { useNostrOptional } from '@/providers/nostr-context'
import { useNoteFeedProfileContext } from '@/providers/NoteFeedProfileContext'
import { eventService, replaceableEventService } from '@/services/client.service'
import { ReplaceableEventService } from '@/services/client-replaceable-events.service'
import indexedDb from '@/services/indexed-db.service'
import { TProfile } from '@/types'
import { kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import logger from '@/lib/logger'

function tryHydrateProfileFromSessionOnly(pubkey: string, skipCache: boolean): TProfile | null {
  if (skipCache) return null
  const pk = pubkey.toLowerCase()
  const sessionEv = eventService.getSessionMetadataForPubkey(pk)
  if (sessionEv) {
    return getProfileFromEvent(sessionEv)
  }
  return null
}

/** Single-flight IndexedDB kind-0 read (never blocks callers until they await the promise). */
function profileFromIdbPromise(pubkey: string, skipCache: boolean): Promise<TProfile | null> {
  if (skipCache) return Promise.resolve(null)
  const pk = pubkey.toLowerCase()
  return indexedDb
    .getReplaceableEvent(pk, kinds.Metadata)
    .then((idbEv) => {
      if (idbEv && !shouldDropEventOnIngest(idbEv)) {
        return getProfileFromEvent(idbEv)
      }
      return null
    })
    .catch(() => null)
}

/**
 * Session LRU + IndexedDB kind 0 without ReplaceableEventService / batched DataLoader.
 * Used when the hook's fetch race times out or the batch path is slow while disk/session already has metadata.
 */
async function tryHydrateProfileFromLocalCaches(
  pubkey: string,
  skipCache: boolean
): Promise<TProfile | null> {
  const fromSession = tryHydrateProfileFromSessionOnly(pubkey, skipCache)
  if (fromSession) return fromSession
  return profileFromIdbPromise(pubkey, skipCache)
}

// CRITICAL: Global deduplication - shared across ALL hook instances
// This prevents multiple components from fetching the same profile simultaneously
const globalFetchPromises = new Map<string, Promise<TProfile | null>>()
const globalFetchingPubkeys = new Set<string>()
// Cooldown period after timeout to prevent cascade of duplicate fetches
const globalFetchCooldowns = new Map<string, number>() // pubkey -> timestamp when cooldown expires

export function useFetchProfile(id?: string, skipCache = false) {
  const nostr = useNostrOptional()
  const currentAccountProfile = nostr?.profile ?? null
  const noteFeed = useNoteFeedProfileContext()
  /** Hex/npub ids can show npub fallback immediately; avoid a skeleton frame before the first effect. */
  const [isFetching, setIsFetching] = useState(() => {
    if (!id) return false
    const pk = userIdToPubkey(id)
    return !(pk.length === 64 && /^[0-9a-f]{64}$/.test(pk))
  })
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const processingPubkeyRef = useRef<string | null>(null) // Track which pubkey we're currently processing (prevents duplicate fetches)
  const effectRunCountRef = useRef<Map<string, number>>(new Map()) // Track how many times effect has run for each pubkey (safety guard against infinite loops)
  const initializedPubkeysRef = useRef<Set<string>>(new Set()) // Track pubkeys we've successfully initialized (have profile or failed)

  const pkLowerResolved = useMemo(() => {
    if (!id) return null as string | null
    const pk = userIdToPubkey(id)
    if (pk.length !== 64 || !/^[0-9a-f]{64}$/i.test(pk)) return null
    return pk.toLowerCase()
  }, [id])

  const isPendingInFeed = Boolean(
    pkLowerResolved && noteFeed?.pendingPubkeys.has(pkLowerResolved)
  )

  /**
   * Changes when this row's batched profile row appears/updates — **not** on every feed-wide
   * `version` tick (that remounted thousands of avatars and spammed relay fetches).
   */
  const feedProfileSyncKey = useMemo(() => {
    if (!pkLowerResolved || !noteFeed) return ''
    const row = noteFeed.profiles.get(pkLowerResolved)
    if (!row) return isPendingInFeed ? 'p:wait' : 'p:none'
    return [
      row.batchPlaceholder ? 'ph' : 'ok',
      row.username ?? '',
      row.avatar ?? '',
      row.npub ?? ''
    ].join('\x1e')
  }, [pkLowerResolved, noteFeed?.profiles, isPendingInFeed])

  // Function to check for profile updates with GLOBAL deduplication
  // fetchProfileEvent already checks: 1) IndexedDB, 2) network (with author's relays)
  // Memoize to prevent recreation on every render
  const checkProfile = useCallback(async (pubkey: string, cancelled: { current: boolean }): Promise<TProfile | null> => {
    if (cancelled.current) {
      return null
    }

    if (shouldDeferPerPubkeyProfileNetwork(pubkey)) {
      const cachedDuringBatch = await tryHydrateProfileFromLocalCaches(pubkey, skipCache)
      if (!cancelled.current && cachedDuringBatch) {
        setProfile(cachedDuringBatch)
        setIsFetching(false)
        initializedPubkeysRef.current.add(pubkey)
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
        effectRunCountRef.current.delete(pubkey)
        return cachedDuringBatch
      }
      return null
    }

    // CRITICAL: Check cooldown period first to prevent cascade of duplicate fetches after timeout.
    // Still hydrate from session/IndexedDB — otherwise new rows remount after a timeout and stay on
    // identicons until cooldown ends with no effect re-run (deps unchanged).
    const cooldownExpiry = globalFetchCooldowns.get(pubkey)
    if (cooldownExpiry && Date.now() < cooldownExpiry) {
      const cachedDuringCooldown = await tryHydrateProfileFromLocalCaches(pubkey, skipCache)
      if (!cancelled.current && cachedDuringCooldown) {
        setProfile(cachedDuringCooldown)
        setIsFetching(false)
        initializedPubkeysRef.current.add(pubkey)
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
        effectRunCountRef.current.delete(pubkey)
        return cachedDuringCooldown
      }
      return null
    }
    // Clean up expired cooldowns
    if (cooldownExpiry && Date.now() >= cooldownExpiry) {
      globalFetchCooldowns.delete(pubkey)
    }
    
    // CRITICAL: Check if another hook instance is already fetching this pubkey
    // If so, wait for that fetch to complete instead of starting a new one
    // Add timeout protection to prevent infinite waits
    const existingPromise = globalFetchPromises.get(pubkey)
    if (existingPromise) {
      try {
        // Await the shared promise only — it already races fetchProfileEvent with
        // PROFILE_FETCH_PROMISE_TIMEOUT_MS. Per-waiter Promise.race timers caused N identical
        // "timeout" warnings (one per mounted component) and premature map deletion.
        const existingProfile = await existingPromise
        if (cancelled.current) return null

        if (existingProfile) {
          // Update state for this instance
          setProfile(existingProfile)
          setIsFetching(false)
          initializedPubkeysRef.current.add(pubkey)
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          effectRunCountRef.current.delete(pubkey)
          return existingProfile
        } else {
          setIsFetching(false)
          return null
        }
      } catch (err) {
        // If the existing promise failed, we'll try again below
        void err
        // Clear the failed promise so we can start fresh
        globalFetchPromises.delete(pubkey)
        globalFetchingPubkeys.delete(pubkey)
      }
    }
    
    // Mark as fetching globally to prevent other instances from starting
    if (globalFetchingPubkeys.has(pubkey)) {
      // Another instance is fetching, wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 50))
      const retryPromise = globalFetchPromises.get(pubkey)
      if (retryPromise) {
        try {
          const retryProfile = await retryPromise
          if (cancelled.current) return null

          if (retryProfile) {
            // Update state for this instance
            setProfile(retryProfile)
            setIsFetching(false)
            initializedPubkeysRef.current.add(pubkey)
            if (checkIntervalRef.current) {
              clearInterval(checkIntervalRef.current)
              checkIntervalRef.current = null
            }
            effectRunCountRef.current.delete(pubkey)
            return retryProfile
          } else {
            setIsFetching(false)
            return null
          }
        } catch (err) {
          void err
          // Clear the failed promise
          globalFetchPromises.delete(pubkey)
          globalFetchingPubkeys.delete(pubkey)
          // Fall through to start our own fetch
        }
      }
    }
    
    // Create a new fetch promise with timeout protection
    const fetchPromise = (async (): Promise<TProfile | null> => {
      let idbEarlyP: Promise<TProfile | null> | null = null
      try {
        globalFetchingPubkeys.add(pubkey)

        /** Session-only fast path removed: {@link replaceableEventService.fetchProfileEvent} still refreshes from relays while session primes the loader. */

        /** Disk read runs in parallel with `fetchProfileEvent` — never block network on IDB. */
        idbEarlyP = profileFromIdbPromise(pubkey, skipCache)

        // CRITICAL: Add timeout to prevent infinite hangs (must exceed batched metadata query globalTimeout)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `Profile fetch timeout after ${PROFILE_FETCH_PROMISE_TIMEOUT_MS}ms for pubkey ${pubkey.substring(0, 8)}`
              )
            )
          }, PROFILE_FETCH_PROMISE_TIMEOUT_MS)
        })
        
        // Use fetchProfileEvent which includes author's relay list for better profile discovery
        const profileEvent = await Promise.race([
          replaceableEventService.fetchProfileEvent(pubkey, skipCache),
          timeoutPromise
        ])
        if (profileEvent) {
          // getProfileFromEvent always returns a profile object (with fallback username)
          const newProfile = getProfileFromEvent(profileEvent)
          // CRITICAL: Always return the profile from this shared promise, even when the
          // originating hook cleaned up (list virtualization, Strict Mode, feed switch).
          // Returning null here made every waiter treat the result like a timeout, applied
          // cooldowns, and left avatars empty (especially busy feeds e.g. all-favorites).
          return newProfile
        }
        const afterMiss =
          (idbEarlyP != null ? await idbEarlyP : null) ?? tryHydrateProfileFromSessionOnly(pubkey, skipCache)
        if (afterMiss) {
          return afterMiss
        }
        return null
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes('timeout')
        if (isTimeout) {
          // Set cooldown period after timeout to prevent cascade of duplicate fetches
          globalFetchCooldowns.set(pubkey, Date.now() + 10000) // 10 second cooldown
          const fallback =
            tryHydrateProfileFromSessionOnly(pubkey, skipCache) ??
            (idbEarlyP != null ? await idbEarlyP : null)
          if (fallback) {
            return fallback
          }
          // Return null on timeout instead of throwing - allows UI to show fallback
          return null
        }
        logger.error('[useFetchProfile] Profile fetch error', {
          pubkey: pubkey.substring(0, 8),
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          cancelled: cancelled.current
        })
        // For non-timeout errors, still throw to allow retry logic
        throw err
      } finally {
        // Clean up global tracking
        globalFetchingPubkeys.delete(pubkey)
        // Keep promise in cache for a short time to allow other instances to reuse it
        // But remove it immediately on timeout/error to allow retries
        setTimeout(() => {
          globalFetchPromises.delete(pubkey)
        }, 1000) // 1 second cache retention
      }
    })()
    
    // Store the promise globally so other instances can reuse it
    globalFetchPromises.set(pubkey, fetchPromise)
    
    try {
      const profile = await fetchPromise
      if (cancelled.current) return null
      
      if (profile) {
        setProfile(profile)
        setIsFetching(false)
        // Mark as initialized
        initializedPubkeysRef.current.add(pubkey)
        // Keep processingPubkeyRef set so we don't re-fetch
        // Clear interval once we have a profile
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current)
          checkIntervalRef.current = null
        }
        // Clear run count when profile is found
        effectRunCountRef.current.delete(pubkey)
        return profile
      }
      
      if (!cancelled.current) {
        setIsFetching(false)
      }
      return null
    } catch (err) {
      if (!cancelled.current) {
        setError(err as Error)
        setIsFetching(false)
      }
      return null
    }
  }, [skipCache])

  useEffect(() => {
    if (!id) {
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('No id provided'))
      processingPubkeyRef.current = null
      return
    }

    const extractedPubkey = userIdToPubkey(id)

    // Note feeds: profiles are batch-fetched in NoteList — skip per-row relay storms while pending.
    if (extractedPubkey && noteFeed && !skipCache) {
      const pkL = extractedPubkey.toLowerCase()
      const fromBatch = noteFeed.profiles.get(pkL) ?? noteFeed.profiles.get(extractedPubkey)
      if (fromBatch && !fromBatch.batchPlaceholder) {
        setProfile(fromBatch)
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
        processingPubkeyRef.current = extractedPubkey
        initializedPubkeysRef.current.add(extractedPubkey)
        effectRunCountRef.current.delete(extractedPubkey)
        return
      }
      if (fromBatch?.batchPlaceholder) {
        initializedPubkeysRef.current.delete(extractedPubkey)
        setProfile(fromBatch)
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
      }
      if (noteFeed.pendingPubkeys.has(pkL) || isPubkeyAwaitingProfileBatch(pkL)) {
        const sessionEv = eventService.getSessionMetadataForPubkey(pkL)
        if (sessionEv) {
          const quick = getProfileFromEvent(sessionEv)
          setProfile(quick)
          setPubkey(extractedPubkey)
          setIsFetching(false)
          setError(null)
          processingPubkeyRef.current = extractedPubkey
          initializedPubkeysRef.current.add(extractedPubkey)
          effectRunCountRef.current.delete(extractedPubkey)
          return
        }
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
        const pendingCancelled = { current: false }
        void tryHydrateProfileFromLocalCaches(pkL, false).then((quick) => {
          if (pendingCancelled.current || !quick) return
          setProfile(quick)
          setIsFetching(false)
          setError(null)
          processingPubkeyRef.current = extractedPubkey
          initializedPubkeysRef.current.add(extractedPubkey)
          effectRunCountRef.current.delete(extractedPubkey)
        })
        const pendingEscapeTimer = window.setTimeout(() => {
          if (pendingCancelled.current) return
          const s2 = eventService.getSessionMetadataForPubkey(pkL)
          if (s2) {
            const q = getProfileFromEvent(s2)
            setProfile(q)
            setIsFetching(false)
            setError(null)
            processingPubkeyRef.current = extractedPubkey
            initializedPubkeysRef.current.add(extractedPubkey)
            effectRunCountRef.current.delete(extractedPubkey)
            return
          }
          void checkProfile(extractedPubkey, pendingCancelled)
        }, FEED_PROFILE_PENDING_BATCH_ESCAPE_MS)
        return () => {
          pendingCancelled.current = true
          window.clearTimeout(pendingEscapeTimer)
          if (processingPubkeyRef.current === extractedPubkey) {
            processingPubkeyRef.current = null
          }
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          if (extractedPubkey) {
            effectRunCountRef.current.delete(extractedPubkey)
          }
        }
      }
      if (fromBatch?.batchPlaceholder) {
        const placeholderCancelled = { current: false }
        void tryHydrateProfileFromLocalCaches(pkL, false).then((quick) => {
          if (placeholderCancelled.current || !quick) return
          setProfile(quick)
          setIsFetching(false)
          setError(null)
          processingPubkeyRef.current = extractedPubkey
          initializedPubkeysRef.current.add(extractedPubkey)
          effectRunCountRef.current.delete(extractedPubkey)
        })
        return () => {
          placeholderCancelled.current = true
          if (processingPubkeyRef.current === extractedPubkey) {
            processingPubkeyRef.current = null
          }
          if (checkIntervalRef.current) {
            clearInterval(checkIntervalRef.current)
            checkIntervalRef.current = null
          }
          if (extractedPubkey) {
            effectRunCountRef.current.delete(extractedPubkey)
          }
        }
      }
    }

    // Userbadge → profile panel: feed row already had this profile, but secondary stack is outside NoteFeedProfileContext.
    if (extractedPubkey && !skipCache) {
      const fromNavigation = getSeededProfileForNavigation(extractedPubkey)
      if (fromNavigation) {
        setProfile(fromNavigation)
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
        processingPubkeyRef.current = extractedPubkey
        initializedPubkeysRef.current.add(extractedPubkey)
        effectRunCountRef.current.delete(extractedPubkey)
        return
      }
    }

    if (extractedPubkey && !skipCache && isPubkeyAwaitingProfileBatch(extractedPubkey)) {
      const pkL = extractedPubkey.toLowerCase()
      const sessionEv = eventService.getSessionMetadataForPubkey(pkL)
      if (sessionEv) {
        const quick = getProfileFromEvent(sessionEv)
        setProfile(quick)
        setPubkey(extractedPubkey)
        setIsFetching(false)
        setError(null)
        processingPubkeyRef.current = extractedPubkey
        initializedPubkeysRef.current.add(extractedPubkey)
        effectRunCountRef.current.delete(extractedPubkey)
        return
      }
      setPubkey(extractedPubkey)
      setIsFetching(false)
      setError(null)
      return
    }

    // Skip only when this pubkey already has an in-flight fetch (global dedupe + local flag).
    if (extractedPubkey) {
      if (processingPubkeyRef.current === extractedPubkey) {
        const sharedPromise = globalFetchPromises.get(extractedPubkey)
        const busy =
          Boolean(sharedPromise) ||
          globalFetchingPubkeys.has(extractedPubkey) ||
          isFetching
        if (busy) return
        if (profile?.pubkey === extractedPubkey && !profile.batchPlaceholder) return
      }
      processingPubkeyRef.current = extractedPubkey
    }

    if (extractedPubkey && profile && profile.pubkey === extractedPubkey && !profile.batchPlaceholder) {
      if (processingPubkeyRef.current !== extractedPubkey) {
        processingPubkeyRef.current = extractedPubkey
      }
      initializedPubkeysRef.current.add(extractedPubkey)
      if (isFetching) {
        setIsFetching(false)
      }
      effectRunCountRef.current.delete(extractedPubkey)
      return
    }

    if (extractedPubkey && initializedPubkeysRef.current.has(extractedPubkey) && !profile) {
      if (skipCache) {
        initializedPubkeysRef.current.delete(extractedPubkey)
        effectRunCountRef.current.delete(extractedPubkey)
      } else {
        if (isFetching) {
          setIsFetching(false)
        }
        return
      }
    }

    if (extractedPubkey) {
      const runCount = effectRunCountRef.current.get(extractedPubkey) || 0
      const pkLower = extractedPubkey.toLowerCase()
      const feedBatchPlaceholder =
        noteFeed?.profiles.get(pkLower)?.batchPlaceholder === true ||
        noteFeed?.profiles.get(extractedPubkey)?.batchPlaceholder === true
      const maxRunsBeforeCircuitBreak = feedBatchPlaceholder ? 6 : 3
      if (runCount >= maxRunsBeforeCircuitBreak) {
        logger.warn('[useFetchProfile] Too many effect runs for this pubkey, preventing infinite loop', {
          extractedPubkey,
          runCount
        })
        setTimeout(() => {
          effectRunCountRef.current.delete(extractedPubkey)
        }, 30000)
        processingPubkeyRef.current = null
        if (isFetching) setIsFetching(false)
        return
      }
      effectRunCountRef.current.set(extractedPubkey, runCount + 1)
    }

    if (extractedPubkey && processingPubkeyRef.current && processingPubkeyRef.current !== extractedPubkey) {
      const oldPubkey = processingPubkeyRef.current
      effectRunCountRef.current.delete(oldPubkey)
      initializedPubkeysRef.current.delete(oldPubkey)
      processingPubkeyRef.current = null
    }

    const cancelled = { current: false }

    if (!extractedPubkey) {
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error('Invalid id: could not extract pubkey'))
      processingPubkeyRef.current = null
      return
    }

    if (extractedPubkey.length !== 64 || !/^[0-9a-f]{64}$/.test(extractedPubkey)) {
      setProfile(null)
      setPubkey(null)
      setIsFetching(false)
      setError(new Error(`Invalid pubkey format: expected 64 hex chars, got ${extractedPubkey.length}`))
      processingPubkeyRef.current = null
      return
    }

    if (processingPubkeyRef.current !== extractedPubkey) {
      logger.warn('[useFetchProfile] processingPubkeyRef mismatch (safety check)', {
        extractedPubkey,
        processingPubkey: processingPubkeyRef.current
      })
      processingPubkeyRef.current = extractedPubkey
    }

    if (profile && profile.pubkey === extractedPubkey && !profile.batchPlaceholder) {
      setIsFetching(false)
      effectRunCountRef.current.delete(extractedPubkey)
      return
    }

    if (pubkey !== extractedPubkey) {
      setPubkey(extractedPubkey)
    }

    const run = async () => {
      try {
        setError(null)
        const earlyProfile =
          tryHydrateProfileFromSessionOnly(extractedPubkey, skipCache) ??
          (await profileFromIdbPromise(extractedPubkey, skipCache))
        if (!cancelled.current && earlyProfile) {
          setProfile(earlyProfile)
          setIsFetching(false)
        } else if (!cancelled.current) {
          setIsFetching(true)
        }

        const profile = await checkProfile(extractedPubkey, cancelled)

        if (cancelled.current) {
          setIsFetching(false)
          return
        }

        if (profile) {
          return
        }

        setIsFetching(false)
        setError(null)

        if (skipCache) {
          let checkCount = 0
          const maxChecks = 3
          const startTime = Date.now()
          const maxTotalTime = 20000

          checkIntervalRef.current = setInterval(async () => {
            const elapsed = Date.now() - startTime
            if (elapsed > maxTotalTime) {
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
              return
            }

            if (cancelled.current || checkCount >= maxChecks) {
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
              return
            }

            checkCount++
            const profile = await checkProfile(extractedPubkey, cancelled)
            if (profile || cancelled.current) {
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current)
                checkIntervalRef.current = null
              }
            }
          }, 10000)
        }
      } catch (err) {
        logger.error('[useFetchProfile] run() error', {
          pubkey: extractedPubkey,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined
        })
        if (!cancelled.current) {
          setError(err as Error)
          setIsFetching(false)
        }
      }
    }

    run().catch((err) => {
      logger.error('[useFetchProfile] Unhandled error in run()', {
        pubkey: extractedPubkey,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      })
    })
    return () => {
      cancelled.current = true
      if (processingPubkeyRef.current === extractedPubkey) {
        processingPubkeyRef.current = null
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
        checkIntervalRef.current = null
      }
      if (extractedPubkey) {
        effectRunCountRef.current.delete(extractedPubkey)
      }
    }
  }, [id, skipCache, feedProfileSyncKey, checkProfile])

  useEffect(() => {
    const acc = currentAccountProfile
    const accPk = acc?.pubkey
    if (!accPk || !id) return
    const targetPk = userIdToPubkey(id)
    if (targetPk.length !== 64 || !/^[0-9a-f]{64}$/i.test(targetPk)) return
    if (targetPk !== accPk.toLowerCase()) return

    const profilePk = profile?.pubkey?.trim()
    const haveFullLocal =
      !!profilePk &&
      /^[0-9a-f]{64}$/i.test(profilePk) &&
      normalizeHexPubkey(profilePk) === targetPk &&
      !profile?.batchPlaceholder
    if (haveFullLocal) return

    setProfile(acc)
    setIsFetching(false)
    setError(null)
    processingPubkeyRef.current = targetPk
    initializedPubkeysRef.current.add(targetPk)
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current)
      checkIntervalRef.current = null
    }
    effectRunCountRef.current.delete(targetPk)
  }, [currentAccountProfile, id, profile])

  const profileRefreshCancelledRef = useRef(false)
  useEffect(() => {
    profileRefreshCancelledRef.current = false
    return () => {
      profileRefreshCancelledRef.current = true
    }
  }, [pkLowerResolved])

  useEffect(() => {
    if (!pkLowerResolved) return
    const onAuthorReplaceablesRefreshed: EventListener = (domEvt) => {
      const detailPk = (domEvt as CustomEvent<{ pubkey?: string }>).detail?.pubkey?.toLowerCase()
      if (detailPk !== pkLowerResolved) return
      // Background profile-view refresh already persisted kind 0 — avoid a second full fetchProfileEvent pass.
      if (initializedPubkeysRef.current.has(pkLowerResolved)) return
      void checkProfile(pkLowerResolved, { current: profileRefreshCancelledRef.current })
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
  }, [pkLowerResolved, checkProfile])

  return { isFetching, error, profile }
}
