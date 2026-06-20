import { ExtendedKind } from '@/constants'
import {
  buildShortNoteEditState,
  peekKind1ThreadRootFromParent,
  type ShortNoteEditState
} from '@/lib/short-note-edits'
import client from '@/services/client.service'
import { queryService } from '@/services/client.service'
import DataLoader from 'dataloader'
import type { Event, Filter } from 'nostr-tools'

type FetchKey = {
  noteId: string
  authorPubkey: string
  relays: string[]
}

class ShortNoteEditsService {
  static instance: ShortNoteEditsService

  private stateMap = new Map<string, ShortNoteEditState>()
  private subscribers = new Map<string, Set<() => void>>()

  private loader = new DataLoader<FetchKey, ShortNoteEditState | undefined>(
    async (keys) => {
      const byNote = new Map<string, FetchKey>()
      for (const key of keys) {
        const id = key.noteId.toLowerCase()
        if (!byNote.has(id)) byNote.set(id, key)
      }

      const results = await Promise.all(
        Array.from(byNote.entries()).map(async ([noteId, key]) => {
          const state = await this.fetchFromRelays(noteId, key.authorPubkey, key.relays)
          return { noteId, state }
        })
      )

      const resultMap = new Map<string, ShortNoteEditState>()
      for (const { noteId, state } of results) {
        if (state) resultMap.set(noteId, state)
      }

      return keys.map((k) => resultMap.get(k.noteId.toLowerCase()))
    },
    { cache: false }
  )

  constructor() {
    if (!ShortNoteEditsService.instance) {
      ShortNoteEditsService.instance = this
    }
    return ShortNoteEditsService.instance
  }

  private cacheKey(noteId: string): string {
    return noteId.toLowerCase()
  }

  private notify(noteId: string): void {
    const set = this.subscribers.get(this.cacheKey(noteId))
    set?.forEach((cb) => cb())
  }

  subscribe(noteId: string, callback: () => void): () => void {
    const key = this.cacheKey(noteId)
    let set = this.subscribers.get(key)
    if (!set) {
      set = new Set()
      this.subscribers.set(key, set)
    }
    set.add(callback)
    return () => {
      set?.delete(callback)
      if (set?.size === 0) this.subscribers.delete(key)
    }
  }

  getState(noteId: string): ShortNoteEditState | undefined {
    return this.stateMap.get(this.cacheKey(noteId))
  }

  /** Merge a freshly published or live edit into cached state. */
  ingestEdit(kind1: Pick<Event, 'id' | 'pubkey'>, edit: Event): void {
    const key = this.cacheKey(kind1.id)
    const prev = this.stateMap.get(key)
    const merged = prev
      ? buildShortNoteEditState([...prev.authorEdits, edit], kind1)
      : buildShortNoteEditState([edit], kind1)
    this.stateMap.set(key, merged)
    client.addEventToCache(edit)
    this.notify(kind1.id)
  }

  async fetchEdits(
    noteId: string,
    authorPubkey: string,
    relays: readonly string[]
  ): Promise<ShortNoteEditState | undefined> {
    const relayList = [...relays]
    if (relayList.length === 0) {
      const hints = client.getEventHints(noteId)
      relayList.push(...hints)
    }
    const result = await this.loader.load({
      noteId: noteId.toLowerCase(),
      authorPubkey,
      relays: relayList
    })
    if (result) {
      this.stateMap.set(this.cacheKey(noteId), result)
      this.notify(noteId)
    }
    return result
  }

  private async fetchFromRelays(
    noteId: string,
    authorPubkey: string,
    relays: string[]
  ): Promise<ShortNoteEditState | undefined> {
    if (relays.length === 0) return undefined

    const filter: Filter = {
      kinds: [ExtendedKind.SHORT_NOTE_EDIT],
      '#e': [noteId.toLowerCase()],
      limit: 50
    }

    const edits = await queryService.fetchEvents(relays, filter)
    for (const edit of edits) client.addEventToCache(edit)

    const kind1Stub = { id: noteId, pubkey: authorPubkey }
    return buildShortNoteEditState(edits, kind1Stub)
  }

  /** Latest author edit for a kind-1 thread when composing a reply. */
  async resolveLatestEditForReplyParent(
    parentEvent: Event,
    relays: readonly string[]
  ): Promise<Event | undefined> {
    const kind1 = peekKind1ThreadRootFromParent(parentEvent)
    if (!kind1) return undefined
    const state = await this.fetchEdits(kind1.id, kind1.pubkey, relays)
    return state?.latestAuthorEdit
  }
}

const instance = new ShortNoteEditsService()
export default instance
