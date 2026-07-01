import { isMobileBrowserProfile } from '@/lib/client-platform'
import { indexPublicationEvents } from '@/lib/publication-asciidoc-assembler'
import {
  collectPendingPublicationSectionLoads,
  collectPublicationSectionLoadsForAddress,
  countPublicationSectionLoadProgress,
  fetchPublicationSection,
  fetchedPublicationEventForAddress,
  type PublicationSectionLoadTask
} from '@/lib/publication-section-loader'
import { publicationRefKey, type PublicationSectionRef } from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'

const READ_AHEAD_COUNT = 2
/** Sections to prefetch before revealing the reader (avoids layout shift while reading). */
const BLOCKING_PREFETCH_LIMIT = isMobileBrowserProfile() ? 24 : 32
const BLOCKING_BATCH_SIZE = 6

export function useProgressivePublicationContent(
  rootIndex: Event,
  relayUrls: string[],
  options?: {
    enabled?: boolean
    seedContentEvent?: Event
    priorityAddress?: string
    /** When false, skip read-ahead and bulk prefetch (keeps quote scroll stable). */
    backgroundLoads?: boolean
  }
) {
  const enabled = options?.enabled ?? true
  const seedContentEvent = options?.seedContentEvent
  const priorityAddress = options?.priorityAddress?.trim() || undefined
  const backgroundLoads = options?.backgroundLoads ?? true
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const [fetched, setFetched] = useState<Map<string, Event>>(() => {
    const seed = new Map<string, Event>()
    indexPublicationEvents(seed, [rootIndex])
    if (seedContentEvent) indexPublicationEvents(seed, [seedContentEvent])
    return seed
  })
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set())
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set())
  const [contentReady, setContentReady] = useState(false)
  const [loadProgress, setLoadProgress] = useState({ resolved: 0, pending: 0 })

  const inFlightRef = useRef<Set<string>>(new Set())
  const fetchedRef = useRef(fetched)
  const failedRef = useRef(failedKeys)
  fetchedRef.current = fetched
  failedRef.current = failedKeys

  const relayKey = relayUrls.join('|')

  const syncLoadProgress = useCallback(() => {
    const { resolved, pending } = countPublicationSectionLoadProgress(
      rootIndex,
      fetchedRef.current,
      failedRef.current
    )
    setLoadProgress({ resolved, pending })
    return { resolved, pending }
  }, [rootIndex])

  useEffect(() => {
    const seed = new Map<string, Event>()
    indexPublicationEvents(seed, [rootIndex])
    if (seedContentEvent) indexPublicationEvents(seed, [seedContentEvent])
    setFetched(seed)
    setFailedKeys(new Set())
    setLoadingKeys(new Set())
    setContentReady(false)
    inFlightRef.current = new Set()
    syncLoadProgress()
  }, [rootIndex.id, relayKey, rootIndex, seedContentEvent?.id, syncLoadProgress])

  const loadSection = useCallback(
    async (ref: PublicationSectionRef, indexEvent: Event) => {
      if (!enabledRef.current) return
      const key = publicationRefKey(ref)
      if (
        !key ||
        inFlightRef.current.has(key) ||
        fetchedRef.current.has(key) ||
        failedRef.current.has(key)
      ) {
        return
      }

      inFlightRef.current.add(key)
      setLoadingKeys((prev) => new Set(prev).add(key))

      try {
        const ev = await fetchPublicationSection(ref, indexEvent, relayUrls)
        if (ev) {
          setFetched((prev) => {
            const next = new Map(prev)
            indexPublicationEvents(next, [ev])
            fetchedRef.current = next
            return next
          })
        } else {
          setFailedKeys((prev) => {
            const next = new Set(prev).add(key)
            failedRef.current = next
            return next
          })
        }
      } catch {
        setFailedKeys((prev) => {
          const next = new Set(prev).add(key)
          failedRef.current = next
          return next
        })
      } finally {
        inFlightRef.current.delete(key)
        setLoadingKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
        syncLoadProgress()
      }
    },
    [relayUrls, syncLoadProgress]
  )

  const requestLoad = useCallback(
    (ref: PublicationSectionRef, indexEvent: Event) => {
      if (!enabledRef.current) return
      void loadSection(ref, indexEvent)
    },
    [loadSection]
  )

  const prefetchTasks = useCallback(
    (tasks: PublicationSectionLoadTask[]) => {
      for (const task of tasks) {
        void loadSection(task.ref, task.indexEvent)
      }
    },
    [loadSection]
  )

  useEffect(() => {
    if (!enabled) {
      setContentReady(false)
      return
    }

    let cancelled = false
    setContentReady(false)
    syncLoadProgress()

    const loadPriorityPath = async () => {
      if (!priorityAddress) return
      for (let attempt = 0; attempt < 48; attempt++) {
        if (cancelled || !enabledRef.current) return
        if (fetchedPublicationEventForAddress(fetchedRef.current, priorityAddress)) return

        const tasks = collectPublicationSectionLoadsForAddress(
          rootIndex,
          fetchedRef.current,
          failedRef.current,
          inFlightRef.current,
          priorityAddress
        )
        if (tasks.length === 0) return

        await Promise.all(tasks.slice(0, 4).map((task) => loadSection(task.ref, task.indexEvent)))
      }
    }

    const runBlockingPrefetch = async () => {
      // Deep-link / search: only load the target path; defer bulk prefetch to viewport.
      if (priorityAddress) return

      let loadedThisPass = 0
      while (!cancelled && enabledRef.current && loadedThisPass < BLOCKING_PREFETCH_LIMIT) {
        const pending = collectPendingPublicationSectionLoads(
          rootIndex,
          fetchedRef.current,
          failedRef.current,
          inFlightRef.current
        )
        if (pending.length === 0) break

        const batch = pending.slice(0, Math.min(BLOCKING_BATCH_SIZE, BLOCKING_PREFETCH_LIMIT - loadedThisPass))
        if (batch.length === 0) break

        await Promise.all(batch.map((task) => loadSection(task.ref, task.indexEvent)))
        loadedThisPass += batch.length
        syncLoadProgress()
      }
    }

    void (async () => {
      await loadPriorityPath()
      if (cancelled) return
      await runBlockingPrefetch()
      if (cancelled) return
      syncLoadProgress()
      setContentReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [
    enabled,
    rootIndex.id,
    relayKey,
    loadSection,
    rootIndex,
    priorityAddress,
    syncLoadProgress
  ])

  const readAhead = useCallback(() => {
    if (!enabledRef.current || !contentReady) return
    const pending = collectPendingPublicationSectionLoads(
      rootIndex,
      fetchedRef.current,
      failedRef.current,
      inFlightRef.current
    )
    prefetchTasks(pending.slice(0, READ_AHEAD_COUNT))
  }, [prefetchTasks, rootIndex, contentReady])

  useEffect(() => {
    if (!enabled || !backgroundLoads || priorityAddress || !contentReady) return
    readAhead()
  }, [enabled, backgroundLoads, fetched, failedKeys, readAhead, priorityAddress, contentReady])

  return {
    fetched,
    failedKeys,
    loadingKeys,
    contentReady,
    loadProgress,
    requestLoad,
    readAhead
  }
}
