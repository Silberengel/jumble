import { useSecondaryPage } from '@/PageManager'
import { PROFILE_FETCH_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { toProfile } from '@/lib/link'
import client from '@/services/client.service'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import UserItem, { UserItemSkeleton } from '../UserItem'

const LIMIT = 50

const PROFILE_SEARCH_RELAY_URLS = Array.from(
  new Set(PROFILE_FETCH_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean))
)

export function ProfileListBySearch({ search }: { search: string }) {
  const { push } = useSecondaryPage()
  const [until, setUntil] = useState<number>(() => dayjs().unix())
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [pubkeySet, setPubkeySet] = useState(new Set<string>())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setUntil(dayjs().unix())
    setHasMore(true)
    setPubkeySet(new Set<string>())
    loadMore()
  }, [search])

  useEffect(() => {
    if (!hasMore) return
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
        loadMore()
      }
    }, options)

    const currentBottomRef = bottomRef.current

    if (currentBottomRef) {
      observerInstance.observe(currentBottomRef)
    }

    return () => {
      if (observerInstance && currentBottomRef) {
        observerInstance.unobserve(currentBottomRef)
      }
    }
  }, [hasMore, search, until])

  const loadMore = async () => {
    const nextSeen = new Set(pubkeySet)
    const batchPubkeys: string[] = []

    if (pubkeySet.size === 0) {
      const cached = await client.searchProfilesFromIndexedDBCache(search, LIMIT)
      for (const p of cached) {
        if (!nextSeen.has(p.pubkey)) {
          nextSeen.add(p.pubkey)
          batchPubkeys.push(p.pubkey)
        }
      }
    }

    const relayProfiles = await client.searchProfiles(PROFILE_SEARCH_RELAY_URLS, {
      search,
      until,
      limit: LIMIT
    })
    for (const profile of relayProfiles) {
      if (!nextSeen.has(profile.pubkey)) {
        nextSeen.add(profile.pubkey)
        batchPubkeys.push(profile.pubkey)
      }
    }

    if (batchPubkeys.length === 0) {
      setHasMore(false)
      return
    }

    setPubkeySet((prev) => new Set([...prev, ...batchPubkeys]))
    setHasMore(relayProfiles.length >= LIMIT)
    const last = relayProfiles[relayProfiles.length - 1]
    setUntil(last?.created_at ? last.created_at - 1 : 0)
  }

  return (
    <div className="px-4">
      {Array.from(pubkeySet).map((pubkey, index) => (
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
      {hasMore && <UserItemSkeleton />}
      {hasMore && <div ref={bottomRef} />}
    </div>
  )
}
