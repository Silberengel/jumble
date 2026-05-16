import { useSecondaryPage } from '@/PageManager'
import { PROFILE_RELAY_URLS } from '@/constants'
import { decodeProfileSearchQueryToPubkeyHex } from '@/lib/profile-search-query'
import { buildAlexandriaEventsSearchUrlForTSearchParams } from '@/lib/alexandria-events-search-url'
import { toProfile } from '@/lib/link'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UserItem, { UserItemSkeleton } from '../UserItem'
import { AlexandriaEventsSearchEmptyCta } from '@/components/AlexandriaEventsSearchEmptyCta'

const LIMIT = 50

const PROFILE_SEARCH_RELAY_URLS = Array.from(
  new Set(PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean))
)

export function ProfileListBySearch({ search }: { search: string }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const [pubkeys, setPubkeys] = useState<string[]>([])
  const [until, setUntil] = useState(() => dayjs().unix())
  const [hasMore, setHasMore] = useState(true)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [empty, setEmpty] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const loadMoreInFlight = useRef(false)
  const untilRef = useRef(until)
  untilRef.current = until

  /** Initial page: must not read `pubkeySet` from state — it is still the previous search until the next paint. */
  useEffect(() => {
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

        const cached = await client.searchProfilesFromIndexedDBCache(search, LIMIT)
        if (cancelled) return
        for (const p of cached) {
          const pk = p.pubkey.toLowerCase()
          if (seen.has(pk)) continue
          seen.add(pk)
          batch.push(p.pubkey)
        }

        const directPk = decodeProfileSearchQueryToPubkeyHex(search)
        if (directPk && !seen.has(directPk)) {
          seen.add(directPk)
          batch.push(directPk)
          void client.fetchProfileEvent(directPk).catch(() => {})
        }

        const relayProfiles = await client.searchProfiles(PROFILE_SEARCH_RELAY_URLS, {
          search,
          until: untilStart,
          limit: LIMIT
        })
        if (cancelled) return

        for (const profile of relayProfiles) {
          const pk = profile.pubkey.toLowerCase()
          if (seen.has(pk)) continue
          seen.add(pk)
          batch.push(profile.pubkey)
        }

        let nextUntil = untilStart
        if (relayProfiles.length > 0) {
          const last = relayProfiles[relayProfiles.length - 1]!
          const ca = last.created_at
          if (typeof ca === 'number' && ca > 0) {
            nextUntil = ca - 1
          }
        }

        setPubkeys(batch)
        setUntil(nextUntil)
        setHasMore(relayProfiles.length >= LIMIT)
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
    }
  }, [search])

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current || !hasMore) return
    loadMoreInFlight.current = true
    try {
      const relayProfiles = await client.searchProfiles(PROFILE_SEARCH_RELAY_URLS, {
        search,
        until: untilRef.current,
        limit: LIMIT
      })

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
          {(() => {
            const trimmed = search.trim()
            if (!trimmed) return null
            const href = buildAlexandriaEventsSearchUrlForTSearchParams({ type: 'profiles', search })
            return href ? <AlexandriaEventsSearchEmptyCta href={href} /> : null
          })()}
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
          <UserItem pubkey={pubkey} />
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
