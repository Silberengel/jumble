import client from '@/services/client.service'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'

/**
 * Fetches full kind-9802 events for {@link useNoteStatsById}(noteId).highlights so the note body can paint NIP-84 marks.
 */
export function useNip84HighlightTargetEvents(note: Event | null | undefined): Event[] {
  const id = note?.id ?? ''
  const noteStats = useNoteStatsById(id)
  const [events, setEvents] = useState<Event[]>([])
  const highlightIdsKey = useMemo(
    () => (noteStats?.highlights ?? []).map((h) => h.id).join(','),
    [noteStats?.highlights]
  )

  useEffect(() => {
    if (!note || note.kind !== kinds.ShortTextNote) {
      setEvents([])
      return
    }
    const ids = highlightIdsKey.split(',').filter(Boolean)
    if (ids.length === 0) {
      setEvents([])
      return
    }
    let cancelled = false
    void (async () => {
      const loaded: Event[] = []
      for (const hid of ids) {
        try {
          const ev = await client.fetchEvent(hid)
          if (ev && ev.kind === kinds.Highlights) loaded.push(ev)
        } catch {
          /* ignore */
        }
        if (cancelled) return
      }
      if (!cancelled) setEvents(loaded)
    })()
    return () => {
      cancelled = true
    }
  }, [note?.id, note?.kind, highlightIdsKey])

  return events
}
