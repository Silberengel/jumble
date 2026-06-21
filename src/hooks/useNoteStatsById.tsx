import noteStats from '@/services/note-stats.service'
import { useSyncExternalStore } from 'react'

const hexNoteStatsIdRe = /^[0-9a-f]{64}$/i

function canonicalNoteStatsId(noteId: string): string {
  return hexNoteStatsIdRe.test(noteId) ? noteId.toLowerCase() : noteId
}

/** One underlying {@link noteStats.subscribeNoteStats} per note id; fan-out to all React listeners. */
const externalListenersByNoteId = new Map<string, Set<() => void>>()
const serviceUnsubscribeByNoteId = new Map<string, () => void>()

function subscribeNoteStatsDeduped(noteId: string, onStoreChange: () => void): () => void {
  const key = canonicalNoteStatsId(noteId)
  let listeners = externalListenersByNoteId.get(key)
  if (!listeners) {
    listeners = new Set()
    externalListenersByNoteId.set(key, listeners)
    const serviceUnsub = noteStats.subscribeNoteStats(noteId, () => {
      const set = externalListenersByNoteId.get(key)
      if (!set?.size) return
      for (const cb of set) {
        try {
          cb()
        } catch {
          // service layer already logs subscriber failures
        }
      }
    })
    serviceUnsubscribeByNoteId.set(key, serviceUnsub)
  }
  listeners.add(onStoreChange)
  return () => {
    listeners!.delete(onStoreChange)
    if (listeners!.size === 0) {
      serviceUnsubscribeByNoteId.get(key)?.()
      serviceUnsubscribeByNoteId.delete(key)
      externalListenersByNoteId.delete(key)
    }
  }
}

export function useNoteStatsById(noteId: string) {
  return useSyncExternalStore(
    (onStoreChange) => subscribeNoteStatsDeduped(noteId, onStoreChange),
    () => noteStats.getNoteStatsExternalSnapshot(noteId),
    () => noteStats.getNoteStatsExternalSnapshot(noteId)
  ).stats
}
