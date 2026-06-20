import type { ShortNoteEditState } from '@/lib/short-note-edits'
import shortNoteEditsService from '@/services/short-note-edits.service'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import client from '@/services/client.service'
import { useEffect, useSyncExternalStore } from 'react'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'

/** Fetch and subscribe to NIP-41 edits for a kind-1 note. */
export function useShortNoteEdits(event: Event | undefined): ShortNoteEditState | undefined {
  const noteId = event?.kind === kinds.ShortTextNote ? event.id : undefined

  const state = useSyncExternalStore(
    (cb) => (noteId ? shortNoteEditsService.subscribe(noteId, cb) : () => {}),
    () => (noteId ? shortNoteEditsService.getState(noteId) : undefined),
    () => (noteId ? shortNoteEditsService.getState(noteId) : undefined)
  )

  useEffect(() => {
    if (!event || event.kind !== kinds.ShortTextNote) return
    const hints = relayHintsFromEventTags(event)
    const relays = hints.length ? hints : client.getEventHints(event.id)
    void shortNoteEditsService.fetchEdits(event.id, event.pubkey, relays)
  }, [event?.id, event?.kind, event?.pubkey])

  return state
}
