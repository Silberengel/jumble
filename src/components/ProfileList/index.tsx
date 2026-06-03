import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { fetchProfilesMetadataBatch } from '@/lib/profile-metadata-batch'
import type { TProfile } from '@/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import UserItem from '../UserItem'

const PROFILE_CHUNK = 80

export default function ProfileList({ pubkeys }: { pubkeys: string[] }) {
  const [visiblePubkeys, setVisiblePubkeys] = useState<string[]>([])
  const [profilesByPubkey, setProfilesByPubkey] = useState<Map<string, TProfile>>(() => new Map())
  const bottomRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef<Set<string>>(new Set())
  const batchGenRef = useRef(0)
  const pubkeysKey = useMemo(() => pubkeys.join('\u0001'), [pubkeys])

  useEffect(() => {
    setVisiblePubkeys(pubkeys.slice(0, 10))
  }, [pubkeysKey, pubkeys])

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '10px',
      threshold: 1
    }

    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && pubkeys.length > visiblePubkeys.length) {
        setVisiblePubkeys((prev) => [...prev, ...pubkeys.slice(prev.length, prev.length + 10)])
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
  }, [visiblePubkeys, pubkeysKey, pubkeys])

  const visibleHexPubkeysKey = useMemo(
    () =>
      visiblePubkeys
        .filter((pk) => pk.length === 64 && /^[0-9a-f]{64}$/i.test(pk))
        .map((pk) => pk.toLowerCase())
        .join('\u0001'),
    [visiblePubkeys]
  )

  useEffect(() => {
    const need = visibleHexPubkeysKey
      .split('\u0001')
      .filter(Boolean)
      .filter((pk) => !loadedRef.current.has(pk))
    if (need.length === 0) return

    const gen = ++batchGenRef.current
    need.forEach((pk) => loadedRef.current.add(pk))

    void (async () => {
      const chunks: string[][] = []
      for (let i = 0; i < need.length; i += PROFILE_CHUNK) {
        chunks.push(need.slice(i, i + PROFILE_CHUNK))
      }
      const settled = await Promise.allSettled(
        chunks.map((chunk) => fetchProfilesMetadataBatch(chunk))
      )
      if (gen !== batchGenRef.current) return

      setProfilesByPubkey((prev) => {
        const next = new Map(prev)
        settled.forEach((res, idx) => {
          const chunk = chunks[idx]!
          if (res.status === 'rejected') {
            chunk.forEach((pk) => loadedRef.current.delete(pk))
            return
          }
          for (const p of res.value) {
            const pkNorm = p.pubkey.toLowerCase()
            next.set(pkNorm, { ...p, pubkey: pkNorm })
          }
          for (const pk of chunk) {
            const pkNorm = pk.toLowerCase()
            if (!next.has(pkNorm)) {
              next.set(pkNorm, {
                pubkey: pkNorm,
                npub: pubkeyToNpub(pkNorm) ?? '',
                username: formatPubkey(pkNorm),
                batchPlaceholder: true
              })
            }
          }
        })
        return next
      })
    })()
  }, [visibleHexPubkeysKey])

  useEffect(() => {
    batchGenRef.current += 1
    loadedRef.current.clear()
    setProfilesByPubkey(new Map())
  }, [pubkeysKey])

  return (
    <div className="px-4 pt-2">
      {visiblePubkeys.map((pubkey, index) => {
        const pkNorm = pubkey.length === 64 ? pubkey.toLowerCase() : pubkey
        const prefetchedProfile = profilesByPubkey.get(pkNorm)
        return (
          <UserItem
            key={`${index}-${pubkey}`}
            pubkey={pubkey}
            prefetchedProfile={prefetchedProfile}
            deferRemoteAvatar={false}
          />
        )
      })}
      {pubkeys.length > visiblePubkeys.length && <div ref={bottomRef} />}
    </div>
  )
}
