import noteStats from '@/services/note-stats.service'
import { useSyncExternalStore } from 'react'

export function useNoteStatsById(noteId: string) {
  return useSyncExternalStore(
    (onStoreChange) => noteStats.subscribeNoteStats(noteId, onStoreChange),
    () => noteStats.getNoteStatsExternalSnapshot(noteId),
    () => noteStats.getNoteStatsExternalSnapshot(noteId)
  ).stats
}
