import { indexPublicationEvents } from '@/lib/publication-asciidoc-assembler'
import {
  collectPendingPublicationSectionLoads,
  fetchPublicationSection,
  type PublicationSectionLoadTask
} from '@/lib/publication-section-loader'
import { publicationRefKey, type PublicationSectionRef } from '@/lib/publication-section-fetch'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useRef, useState } from 'react'

const INITIAL_PREFETCH_COUNT = 3
const READ_AHEAD_COUNT = 1

export function useProgressivePublicationContent(
  rootIndex: Event,
  relayUrls: string[],
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const [fetched, setFetched] = useState<Map<string, Event>>(() => {
    const seed = new Map<string, Event>()
    indexPublicationEvents(seed, [rootIndex])
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
    setFetched(seed)
    setFailedKeys(new Set())
    setLoadingKeys(new Set())
    inFlightRef.current = new Set()
  }, [rootIndex.id, relayKey, rootIndex])

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
    ;(async () => {
      const pending = collectPendingPublicationSectionLoads(
        rootIndex,
        fetchedRef.current,
        failedRef.current,
        inFlightRef.current
      )
      for (const task of pending.slice(0, INITIAL_PREFETCH_COUNT)) {
        if (cancelled) return
        await loadSection(task.ref, task.indexEvent)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, rootIndex.id, relayKey, loadSection, rootIndex])

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

  return {
    fetched,
    failedKeys,
    loadingKeys,
    requestLoad,
    readAhead
  }
}
