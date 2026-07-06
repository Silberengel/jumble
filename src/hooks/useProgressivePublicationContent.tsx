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
import {
  publicationRefKey,
  registerFetchedPublicationSection,
  resolvePublicationRefEvent,
  type PublicationSectionRef
} from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'

const READ_AHEAD_COUNT = 8
/** Max time to prefetch before revealing the reader (avoids layout shift while reading). */
const BLOCKING_PREFETCH_BUDGET_MS = isMobileBrowserProfile() ? 12_000 : 18_000
const BLOCKING_BATCH_SIZE = 6
const BACKGROUND_DRAIN_BATCH_SIZE = 8

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
  const rootIndexRef = useRef(rootIndex)
  fetchedRef.current = fetched
  failedRef.current = failedKeys
  rootIndexRef.current = rootIndex

  const relayKey = relayUrls.join('|')

  const syncLoadProgress = useCallback(() => {
    const { resolved, pending } = countPublicationSectionLoadProgress(
      rootIndexRef.current,
      fetchedRef.current,
      failedRef.current
    )
    setLoadProgress({ resolved, pending })
    return { resolved, pending }
  }, [])

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
  }, [rootIndex.id, relayKey, seedContentEvent?.id, syncLoadProgress])

  const loadSection = useCallback(
    async (ref: PublicationSectionRef, indexEvent: Event) => {
      if (!enabledRef.current) return
      const key = publicationRefKey(ref)
      if (
        !key ||
        inFlightRef.current.has(key) ||
        resolvePublicationRefEvent(ref, fetchedRef.current) ||
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
            registerFetchedPublicationSection(next, ref, ev)
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
          rootIndexRef.current,
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

      const deadline = Date.now() + BLOCKING_PREFETCH_BUDGET_MS
      while (!cancelled && enabledRef.current && Date.now() < deadline) {
        const pending = collectPendingPublicationSectionLoads(
          rootIndexRef.current,
          fetchedRef.current,
          failedRef.current,
          inFlightRef.current
        )
        if (pending.length === 0) {
          if (inFlightRef.current.size > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 50))
            continue
          }
          break
        }

        const batch = pending.slice(0, BLOCKING_BATCH_SIZE)
        await Promise.all(batch.map((task) => loadSection(task.ref, task.indexEvent)))
        syncLoadProgress()
      }
    }

    const drainInFlight = async () => {
      while (!cancelled && inFlightRef.current.size > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 50))
      }
    }

    void (async () => {
      await loadPriorityPath()
      if (cancelled) return
      await runBlockingPrefetch()
      if (cancelled) return
      await drainInFlight()
      if (cancelled) return
      syncLoadProgress()
      setContentReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, rootIndex.id, relayKey, loadSection, priorityAddress, syncLoadProgress])

  const readAhead = useCallback(() => {
    if (!enabledRef.current || !contentReady) return
    const pending = collectPendingPublicationSectionLoads(
      rootIndexRef.current,
      fetchedRef.current,
      failedRef.current,
      inFlightRef.current
    )
    prefetchTasks(pending.slice(0, READ_AHEAD_COUNT))
  }, [prefetchTasks, contentReady])

  useEffect(() => {
    if (!enabled || !backgroundLoads || !contentReady) return
    readAhead()
  }, [enabled, backgroundLoads, fetched, failedKeys, readAhead, contentReady])

  // Background drain for remaining sections after reveal (skipped during search deep-links).
  useEffect(() => {
    if (!enabled || !contentReady || !backgroundLoads || priorityAddress) return

    let cancelled = false
    void (async () => {
      while (!cancelled && enabledRef.current) {
        const pending = collectPendingPublicationSectionLoads(
          rootIndexRef.current,
          fetchedRef.current,
          failedRef.current,
          inFlightRef.current
        )
        if (pending.length === 0) break
        const batch = pending.slice(0, BACKGROUND_DRAIN_BATCH_SIZE)
        await Promise.all(batch.map((task) => loadSection(task.ref, task.indexEvent)))
        syncLoadProgress()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    enabled,
    contentReady,
    backgroundLoads,
    priorityAddress,
    rootIndex.id,
    loadSection,
    syncLoadProgress
  ])

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
