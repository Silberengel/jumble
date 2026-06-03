import { useSecondaryPage } from '@/PageManager'
import { PROFILE_RELAY_URLS } from '@/constants'
import { dedupeNormalizeRelayUrlsOrdered } from '@/lib/relay-url-priority'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import { fetchProfilesMetadataBatch } from '@/lib/profile-metadata-batch'
import { toProfile } from '@/lib/link'
import client from '@/services/client.service'
import type { TProfile } from '@/types'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UserItem, { UserItemSkeleton } from '../UserItem'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'

const LIMIT = 50

const PROFILE_SEARCH_RELAY_URLS = dedupeNormalizeRelayUrlsOrdered(PROFILE_RELAY_URLS)

export function ProfileListBySearch({
  search,
  alexandriaEmptyHref = null
}: {
  search: string
  alexandriaEmptyHref?: string | null
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const [pubkeys, setPubkeys] = useState<string[]>([])
  const [until, setUntil] = useState(() => dayjs().unix())
  const [hasMore, setHasMore] = useState(true)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [empty, setEmpty] = useState(false)
  const [profilesByPubkey, setProfilesByPubkey] = useState<Map<string, TProfile>>(() => new Map())
  const bottomRef = useRef<HTMLDivElement>(null)
  const profileBatchGenRef = useRef(0)
  const loadMoreInFlight = useRef(false)
  const untilRef = useRef(until)
  untilRef.current = until

  /** Initial page: must not read `pubkeySet` from state — it is still the previous search until the next paint. */
  useEffect(() => {
    const ac = new AbortController()
    let cancelled = false
    const untilStart = dayjs().unix()

    setPhase('loading')
    setEmpty(false)
    setPubkeys([])
    setHasMore(true)
    setUntil(untilStart)

    void (async () => {
      try {
        const seen = new Set<string>()
        const batch: string[] = []

        const mergeProfiles = (profiles: Awaited<ReturnType<typeof client.searchProfilesStaged>>) => {
          for (const profile of profiles) {
            const pk = profile.pubkey.toLowerCase()
            if (seen.has(pk)) continue
            seen.add(pk)
            batch.push(profile.pubkey)
          }
        }

        const staged = await client.searchProfilesStaged(
          search,
          LIMIT,
          (partial) => {
            if (cancelled) return
            mergeProfiles(partial)
            setPubkeys([...batch])
            if (partial.length > 0) setPhase('ready')
          },
          ac.signal
        )
        if (cancelled) return
        mergeProfiles(staged)

        const directPk = decodeProfileSearchQueryToPubkeyHex(search)
        if (directPk && !seen.has(directPk)) {
          seen.add(directPk)
          batch.push(directPk)
          void client.fetchProfileEvent(directPk).catch(() => {})
        }

        let nextUntil = untilStart
        for (const p of staged) {
          const ca = p.created_at
          if (typeof ca === 'number' && ca > 0 && ca < nextUntil) nextUntil = ca - 1
        }

        setPubkeys(batch)
        setUntil(nextUntil)
        setHasMore(staged.length >= LIMIT)
        setEmpty(batch.length === 0)
        setPhase('ready')
      } catch {
        if (!cancelled) {
          setPhase('error')
          setEmpty(true)
          setHasMore(false)
        }
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
  }, [search])

  const pubkeysKey = pubkeys.join('\u0001')

  useEffect(() => {
    const need = pubkeys
      .map((pk) => pk.trim().toLowerCase())
      .filter((pk) => /^[0-9a-f]{64}$/.test(pk))
    if (need.length === 0) {
      setProfilesByPubkey(new Map())
      return
    }

    const gen = ++profileBatchGenRef.current
    void fetchProfilesMetadataBatch(need).then((profiles) => {
      if (gen !== profileBatchGenRef.current) return
      const next = new Map<string, TProfile>()
      for (const p of profiles) {
        next.set(p.pubkey.toLowerCase(), { ...p, pubkey: p.pubkey.toLowerCase() })
      }
      setProfilesByPubkey(next)
    })
  }, [pubkeysKey])

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current || !hasMore) return
    loadMoreInFlight.current = true
    try {
      const relayProfiles = await client.searchProfiles(
        PROFILE_SEARCH_RELAY_URLS,
        {
          search,
          until: untilRef.current,
          limit: LIMIT
        },
        { relaysOnly: true, includeTagFilters: false, eoseTimeout: 6_000, globalTimeout: 9_000 }
      )

      if (relayProfiles.length === 0) {
        setHasMore(false)
        return
      }

      let added = 0
      setPubkeys((prev) => {
        const seen = new Set(prev.map((p) => p.toLowerCase()))
        const next = [...prev]
        for (const profile of relayProfiles) {
          const pk = profile.pubkey.toLowerCase()
          if (seen.has(pk)) continue
          seen.add(pk)
          next.push(profile.pubkey)
        }
        added = next.length - prev.length
        return next
      })

      if (added === 0) {
        setHasMore(false)
        return
      }

      const last = relayProfiles[relayProfiles.length - 1]!
      const ca = last.created_at
      if (typeof ca === 'number' && ca > 0) {
        setUntil(ca - 1)
      }
      setHasMore(relayProfiles.length >= LIMIT)
    } catch {
      setHasMore(false)
    } finally {
      loadMoreInFlight.current = false
    }
  }, [search, hasMore])

  useEffect(() => {
    if (!hasMore || phase !== 'ready') return
    const options = { root: null, rootMargin: '10px', threshold: 1 }
    const el = bottomRef.current
    if (!el) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadMore()
      }
    }, options)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, phase, loadMore, pubkeys.length])

  return (
    <div className="px-4">
      {phase === 'loading' && (
        <div className="px-2 py-4">
          <UserItemSkeleton hideFollowButton />
        </div>
      )}
      {phase === 'error' && (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('Profile search failed')}</p>
      )}
      {phase === 'ready' && empty && (
        <div className="flex flex-col items-center py-6 text-center text-sm text-muted-foreground">
          <p>{t('Profile search no results')}</p>
          {alexandriaEmptyHref ? <AlexandriaEventsSearchEmptyCta href={alexandriaEmptyHref} /> : null}
        </div>
      )}
      {pubkeys.map((pubkey, index) => (
        <div
          key={`${index}-${pubkey}`}
          role="button"
          tabIndex={0}
          className={cn('rounded-lg clickable')}
          onClick={() => {
            client.fetchProfileEvent(pubkey).catch(() => {})
            push(toProfile(pubkey))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              client.fetchProfileEvent(pubkey).catch(() => {})
              push(toProfile(pubkey))
            }
          }}
        >
          <UserItem
            pubkey={pubkey}
            prefetchedProfile={profilesByPubkey.get(pubkey.toLowerCase())}
            deferRemoteAvatar={false}
          />
        </div>
      ))}
      {phase === 'ready' && hasMore && pubkeys.length > 0 && (
        <>
          <UserItemSkeleton hideFollowButton />
          <div ref={bottomRef} />
        </>
      )}
    </div>
  )
}
