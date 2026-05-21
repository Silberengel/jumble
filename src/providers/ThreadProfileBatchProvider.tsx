import client from '@/services/client.service'
import { collectProfilePubkeysFromEvents } from '@/lib/profile-batch-coordinator'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import {
  NoteFeedProfileContext,
  type NoteFeedProfileContextValue,
  useNoteFeedProfileContext
} from '@/providers/NoteFeedProfileContext'
import { TProfile } from '@/types'
import type { Event } from 'nostr-tools'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const PROFILE_CHUNK = 80

type TBatchState = {
  profiles: Map<string, TProfile>
  pending: Set<string>
  version: number
}

function emptyBatch(): TBatchState {
  return { profiles: new Map(), pending: new Set(), version: 0 }
}

/**
 * Batches kind-0 fetches for note/thread views. Seeds run immediately (no debounce) so the
 * open-note author is in {@link NoteFeedProfileContext.pendingPubkeys} before avatars mount.
 */
export function ThreadProfileBatchProvider({
  seedEvents,
  children
}: {
  seedEvents: readonly Event[]
  children: ReactNode
}) {
  const parentNoteFeed = useNoteFeedProfileContext()
  const loadedRef = useRef<Set<string>>(new Set())
  const genRef = useRef(0)
  const [batch, setBatch] = useState<TBatchState>(emptyBatch)

  const runBatch = (need: string[], gen: number) => {
    if (need.length === 0) return
    need.forEach((pk) => loadedRef.current.add(pk))

    setBatch((prev) => {
      const pending = new Set(prev.pending)
      let changed = false
      for (const pk of need) {
        if (!pending.has(pk)) {
          pending.add(pk)
          changed = true
        }
      }
      return changed ? { ...prev, pending } : prev
    })

    void (async () => {
      const chunks: string[][] = []
      for (let i = 0; i < need.length; i += PROFILE_CHUNK) {
        chunks.push(need.slice(i, i + PROFILE_CHUNK))
      }
      const settled = await Promise.allSettled(
        chunks.map((chunk) => client.fetchProfilesForPubkeys(chunk))
      )
      if (gen !== genRef.current) return

      setBatch((prev) => {
        const next = new Map(prev.profiles)
        const pend = new Set(prev.pending)
        settled.forEach((res, idx) => {
          const chunk = chunks[idx]!
          if (res.status === 'rejected') {
            chunk.forEach((pk) => {
              loadedRef.current.delete(pk)
              pend.delete(pk)
            })
            return
          }
          for (const p of res.value) {
            const pkNorm = p.pubkey.toLowerCase()
            next.set(pkNorm, { ...p, pubkey: pkNorm })
            pend.delete(pkNorm)
          }
          for (const pk of chunk) {
            const pkNorm = pk.toLowerCase()
            pend.delete(pkNorm)
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
        return { profiles: next, pending: pend, version: prev.version + 1 }
      })
    })()
  }

  const seedKey = useMemo(
    () => seedEvents.map((e) => e.id).join('\x1e'),
    [seedEvents]
  )

  useLayoutEffect(() => {
    genRef.current += 1
    const gen = genRef.current
    loadedRef.current.clear()
    setBatch(emptyBatch())

    const candidates = collectProfilePubkeysFromEvents(seedEvents)
    const parentProfiles = parentNoteFeed?.profiles
    const parentPending = parentNoteFeed?.pendingPubkeys
    const need = candidates.filter((pk) => {
      if (parentProfiles?.has(pk)) return false
      if (parentPending?.has(pk)) return false
      return true
    })
    runBatch(need, gen)
  }, [seedKey])

  const value = useMemo<NoteFeedProfileContextValue>(() => {
    const profiles = new Map<string, TProfile>(parentNoteFeed?.profiles ?? [])
    for (const [k, v] of batch.profiles) profiles.set(k, v)
    const pending = new Set<string>(parentNoteFeed?.pendingPubkeys ?? [])
    batch.pending.forEach((p) => pending.add(p))
    return {
      profiles,
      pendingPubkeys: pending,
      version: (parentNoteFeed?.version ?? 0) * 1_000_000 + batch.version
    }
  }, [parentNoteFeed, batch])

  return <NoteFeedProfileContext.Provider value={value}>{children}</NoteFeedProfileContext.Provider>
}
