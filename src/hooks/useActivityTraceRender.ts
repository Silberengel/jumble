import activityTrace from '@/lib/activity-trace'
import { useEffect, useRef } from 'react'

/**
 * Counts / samples component re-renders when activity trace is enabled.
 * Pass optional `detail` for props that change often (only logged when verbose).
 */
export function useActivityTraceRender(
  component: string,
  detail?: Record<string, unknown>
): void {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1
  if (!activityTrace.isEnabled()) return
  activityTrace.markRender(component, {
    n: renderCountRef.current,
    ...(activityTrace.isVerbose() && detail ? detail : undefined)
  })
}

/**
 * Logs effect runs when activity trace is enabled.
 */
export function useActivityTraceEffect(
  component: string,
  effectName: string,
  effect: () => void | (() => void),
  deps: readonly unknown[]
): void {
  const runRef = useRef(0)
  useEffect(() => {
    if (!activityTrace.isEnabled()) {
      return effect()
    }
    runRef.current += 1
    activityTrace.trace('effect', `${component}.${effectName}`, {
      run: runRef.current,
      deps: activityTrace.isVerbose() ? deps : deps.length
    })
    return effect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies deps
  }, deps)
}
