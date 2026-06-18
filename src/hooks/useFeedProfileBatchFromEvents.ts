import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import { fetchProfilesMetadataBatch } from '@/lib/profile-metadata-batch'
import {
  NoteFeedProfileContext,
  type NoteFeedProfileContextValue
} from '@/providers/NoteFeedProfileContext'
import type { TProfile } from '@/types'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const DEBOUNCE_MS = 400
const CHUNK = 80
const MAX_P_TAGS = 64

function addPubkey(candidates: Set<string>, raw: string | undefined) {
  if (!raw) return
  const t = raw.trim()
  if (t.length === 64 && /^[0-9a-f]{64}$/i.test(t)) {
    candidates.add(t.toLowerCase())
  }
}

function collectPubkeysFromEvent(e: Event, candidates: Set<string>) {
  addPubkey(candidates, e.pubkey)
  let pCount = 0
  for (const tag of e.tags) {
    if (tag[0] === 'p' && tag[1]) {
      addPubkey(candidates, tag[1])
      pCount++
      if (pCount >= MAX_P_TAGS) break
    }
  }
}

/** Batch-fetch kind-0 metadata for authors visible in a lightweight feed (home timeline). */
export function useFeedProfileBatchFromEvents(events: readonly Event[]) {
  const [batch, setBatch] = useState<{
    profiles: Map<string, TProfile>
    pending: Set<string>
    version: number
  }>({ profiles: new Map(), pending: new Set(), version: 0 })
  const loadedRef = useRef(new Set<string>())
  const genRef = useRef(0)

  const enqueue = useCallback((need: string[]) => {
    if (need.length === 0) return
    const gen = genRef.current
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
      for (let i = 0; i < need.length; i += CHUNK) {
        chunks.push(need.slice(i, i + CHUNK))
      }
      const settled = await Promise.allSettled(
        chunks.map((chunk) => fetchProfilesMetadataBatch(chunk))
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
  }, [])

  useEffect(() => {
    genRef.current += 1
    loadedRef.current.clear()
    setBatch({ profiles: new Map(), pending: new Set(), version: 0 })
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const candidates = new Set<string>()
      for (const e of events.slice(0, 120)) {
        collectPubkeysFromEvent(e, candidates)
      }
      const need = [...candidates].filter((pk) => !loadedRef.current.has(pk))
      enqueue(need)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [events, enqueue])

  const contextValue = useMemo<NoteFeedProfileContextValue>(
    () => ({
      profiles: batch.profiles,
      pendingPubkeys: batch.pending,
      version: batch.version
    }),
    [batch.profiles, batch.pending, batch.version]
  )

  return { contextValue, Provider: NoteFeedProfileContext.Provider }
}
