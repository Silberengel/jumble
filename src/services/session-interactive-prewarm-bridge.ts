/**
 * Multicast hook for {@link ClientService.runSessionPrewarm}'s **interactive** phase (IndexedDB @-mention
 * index + NIP-66). Widgets that depend on a settled relay/follow picture (live activities,
 * sidebar calendar) can register here so they refresh once without waiting for the follow-graph background pass.
 */

const listeners: Array<() => void> = []

/** Returns an unsubscribe function. Safe under React Strict Mode (pair register/unregister). */
export function registerSessionInteractivePrewarmListener(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

export function notifySessionInteractivePrewarmComplete(): void {
  const snapshot = [...listeners]
  for (const fn of snapshot) {
    try {
      fn()
    } catch {
      // ignore listener errors
    }
  }
}
