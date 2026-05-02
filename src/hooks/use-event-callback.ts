import { useCallback, useRef } from 'react'

/**
 * Stable callback identity with always-fresh implementation (React `useEvent` pattern).
 * Avoids stale closures without forcing unrelated consumers to re-render.
 */
export function useEventCallback<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}
