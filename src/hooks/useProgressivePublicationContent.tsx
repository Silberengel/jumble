import { isMobileBrowserProfile } from '@/lib/client-platform'
import { indexPublicationEvents } from '@/lib/publication-asciidoc-assembler'
import {
  collectPendingPublicationSectionLoads,
  collectPublicationSectionLoadsForAddress,
  fetchPublicationSection,
  fetchedPublicationEventForAddress,
  type PublicationSectionLoadTask
} from '@/lib/publication-section-loader'
import { publicationRefKey, type PublicationSectionRef } from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'

const READ_AHEAD_COUNT = 2

function initialPrefetchCount(): number {
  return isMobileBrowserProfile() ? 8 : 5
}

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

  const inFlightRef = useRef<Set<string>>(new Set())
  const fetchedRef = useRef(fetched)
  const failedRef = useRef(failedKeys)
  fetchedRef.current = fetched
  failedRef.current = failedKeys

  const relayKey = relayUrls.join('|')

  useEffect(() => {
    const seed = new Map<string, Event>()
    indexPublicationEvents(seed, [rootIndex])
    if (seedContentEvent) indexPublicationEvents(seed, [seedContentEvent])
    setFetched(seed)
    setFailedKeys(new Set())
    setLoadingKeys(new Set())
    inFlightRef.current = new Set()
  }, [rootIndex.id, relayKey, rootIndex, seedContentEvent?.id])

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
            return next
          })
        } else {
          setFailedKeys((prev) => new Set(prev).add(key))
        }
      } catch {
        setFailedKeys((prev) => new Set(prev).add(key))
      } finally {
        inFlightRef.current.delete(key)
        setLoadingKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [relayUrls]
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
    if (!enabled) return
    let cancelled = false

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

        for (const task of tasks.slice(0, 4)) {
          if (cancelled) return
          await loadSection(task.ref, task.indexEvent)
        }
      }
    }

    ;(async () => {
      await loadPriorityPath()
      if (cancelled || !backgroundLoads || priorityAddress) return
      const pending = collectPendingPublicationSectionLoads(
        rootIndex,
        fetchedRef.current,
        failedRef.current,
        inFlightRef.current
      )
      for (const task of pending.slice(0, initialPrefetchCount())) {
        if (cancelled) return
        await loadSection(task.ref, task.indexEvent)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, rootIndex.id, relayKey, loadSection, rootIndex, priorityAddress, backgroundLoads])

  const readAhead = useCallback(() => {
    if (!enabledRef.current) return
    const pending = collectPendingPublicationSectionLoads(
      rootIndex,
      fetchedRef.current,
      failedRef.current,
      inFlightRef.current
    )
    prefetchTasks(pending.slice(0, READ_AHEAD_COUNT))
  }, [prefetchTasks, rootIndex])

  useEffect(() => {
    if (!enabled || !backgroundLoads || priorityAddress) return
    readAhead()
  }, [enabled, backgroundLoads, fetched, failedKeys, readAhead, priorityAddress])

  return {
    fetched,
    failedKeys,
    loadingKeys,
    requestLoad,
    readAhead
  }
}
