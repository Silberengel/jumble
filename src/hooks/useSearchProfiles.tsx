import { SEARCH_QUERY_DEBOUNCE_MS } from '@/constants'
import client from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useRef, useState } from 'react'

export function useSearchProfiles(
  search: string,
  limit: number,
  debounceMs: number = SEARCH_QUERY_DEBOUNCE_MS
) {
  const [debouncedSearch, setDebouncedSearch] = useState(() => search.trim())
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [profiles, setProfiles] = useState<TProfile[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const partialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const trimmed = search.trim()
    if (!trimmed) {
      setDebouncedSearch('')
      return
    }
    const timer = setTimeout(() => setDebouncedSearch(trimmed), debounceMs)
    return () => clearTimeout(timer)
  }, [search, debounceMs])

  useEffect(() => {
    abortRef.current?.abort()
    if (partialTimerRef.current) clearTimeout(partialTimerRef.current)
    const ac = new AbortController()
    abortRef.current = ac
    let cancelled = false

    const run = async () => {
      if (!debouncedSearch) {
        setProfiles([])
        setIsFetching(false)
        setError(null)
        return
      }

      setIsFetching(true)
      setProfiles([])
      setError(null)
      try {
        const result = await client.searchProfilesStaged(
          debouncedSearch,
          limit,
          (partial) => {
            if (cancelled || ac.signal.aborted) return
            if (partialTimerRef.current) clearTimeout(partialTimerRef.current)
            partialTimerRef.current = setTimeout(() => {
              if (!cancelled && !ac.signal.aborted) setProfiles([...partial])
            }, 80)
          },
          ac.signal
        )
        if (!cancelled && !ac.signal.aborted) setProfiles(result)
      } catch (err) {
        if (!cancelled && !ac.signal.aborted) setError(err as Error)
      } finally {
        if (!cancelled && !ac.signal.aborted) setIsFetching(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      if (partialTimerRef.current) clearTimeout(partialTimerRef.current)
      ac.abort()
    }
  }, [debouncedSearch, limit])

  return { isFetching, error, profiles, debouncedSearch }
}
