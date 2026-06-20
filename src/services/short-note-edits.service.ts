import { ExtendedKind } from '@/constants'
import {
  buildShortNoteEditState,
  getShortNoteEditTargetId,
  mergeShortNoteEditEvents,
  peekKind1ThreadRootFromParent,
  type ShortNoteEditState
} from '@/lib/short-note-edits'
import client from '@/services/client.service'
import { queryService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import DataLoader from 'dataloader'
import type { Event, Filter } from 'nostr-tools'

type FetchKey = {
  noteId: string
  authorPubkey: string
  relays: string[]
}

/** Max kind-1010 rows indexed from the hot event archive per tab session. */
const ARCHIVE_EDIT_INDEX_MAX_MATCHES = 500
const ARCHIVE_EDIT_INDEX_MAX_SCAN = 40_000

class ShortNoteEditsService {
  static instance: ShortNoteEditsService

  private stateMap = new Map<string, ShortNoteEditState>()
  private subscribers = new Map<string, Set<() => void>>()
  /** Kind-1010 rows from IndexedDB, keyed by target kind-1 note id. */
  private archiveEditsByTarget = new Map<string, Event[]>()
  private archiveIndexPromise: Promise<void> | null = null
  private targetedArchiveFetches = new Map<string, Promise<void>>()

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

  private editsFilter(noteId: string): Filter {
    return {
      kinds: [ExtendedKind.SHORT_NOTE_EDIT],
      '#e': [noteId.toLowerCase()],
      limit: 50
    }
  }

  private kind1Stub(noteId: string, authorPubkey: string): Pick<Event, 'id' | 'pubkey'> {
    return { id: noteId, pubkey: authorPubkey }
  }

  /** Track a kind-1010 row by the kind-1 note id in its `e` tag. */
  private indexArchiveEdit(edit: Event): void {
    const target = getShortNoteEditTargetId(edit)
    if (!target) return
    const key = this.cacheKey(target)
    const prev = this.archiveEditsByTarget.get(key) ?? []
    const byId = new Map(prev.map((e) => [e.id.toLowerCase(), e]))
    byId.set(edit.id.toLowerCase(), edit)
    this.archiveEditsByTarget.set(key, [...byId.values()])
  }

  private getIndexedArchiveEdits(noteId: string): Event[] {
    return this.archiveEditsByTarget.get(this.cacheKey(noteId)) ?? []
  }

  /** One scan of hot archive per tab — feeds resolve many kind-1 notes without N archive walks. */
  private async ensureArchiveEditsIndexed(): Promise<void> {
    if (this.archiveIndexPromise) return this.archiveIndexPromise
    this.archiveIndexPromise = (async () => {
      try {
        const edits = await indexedDb.scanEventArchiveByKinds({
          kinds: [ExtendedKind.SHORT_NOTE_EDIT],
          maxRowsScanned: ARCHIVE_EDIT_INDEX_MAX_SCAN,
          maxMatches: ARCHIVE_EDIT_INDEX_MAX_MATCHES
        })
        for (const edit of edits) {
          this.indexArchiveEdit(edit)
          client.addEventToCache(edit)
        }
      } catch {
        /* archive optional */
      }
    })()
    return this.archiveIndexPromise
  }

  /** Targeted `#e` scan when bulk kind-1010 indexing missed a note (large archives). */
  private async ensureTargetedArchiveEdits(noteId: string): Promise<void> {
    if (this.getIndexedArchiveEdits(noteId).length > 0) return
    const key = this.cacheKey(noteId)
    const pending = this.targetedArchiveFetches.get(key)
    if (pending) return pending

    const promise = (async () => {
      try {
        const edits = await indexedDb.scanEventArchiveByFilters([this.editsFilter(noteId)], {
          maxRowsScanned: 50_000,
          maxMatches: 50
        })
        for (const edit of edits) {
          this.indexArchiveEdit(edit)
          client.addEventToCache(edit)
        }
      } catch {
        /* archive optional */
      } finally {
        this.targetedArchiveFetches.delete(key)
      }
    })()
    this.targetedArchiveFetches.set(key, promise)
    return promise
  }

  private mergeIntoState(
    noteId: string,
    authorPubkey: string,
    incomingEdits: readonly Event[]
  ): ShortNoteEditState {
    const prev = this.stateMap.get(this.cacheKey(noteId))
    return mergeShortNoteEditEvents(prev?.authorEdits ?? [], incomingEdits, this.kind1Stub(noteId, authorPubkey))
  }

  private commitState(noteId: string, state: ShortNoteEditState): ShortNoteEditState | undefined {
    if (state.authorEdits.length === 0) {
      return this.stateMap.get(this.cacheKey(noteId))
    }
    this.stateMap.set(this.cacheKey(noteId), state)
    this.notify(noteId)
    return state
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
    this.indexArchiveEdit(edit)
    const merged = this.mergeIntoState(kind1.id, kind1.pubkey, [edit])
    client.addEventToCache(edit)
    this.commitState(kind1.id, merged)
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

    await this.ensureArchiveEditsIndexed()
    await this.ensureTargetedArchiveEdits(noteId)

    const sessionEdits = client.eventService.getSessionEventsMatchingFilters(
      [this.editsFilter(noteId)],
      50
    )
    const archivedEdits = this.getIndexedArchiveEdits(noteId)
    const localMerged = this.mergeIntoState(noteId, authorPubkey, [...sessionEdits, ...archivedEdits])
    this.commitState(noteId, localMerged)

    const fetched = await this.loader.load({
      noteId: noteId.toLowerCase(),
      authorPubkey,
      relays: relayList
    })

    const merged = this.mergeIntoState(noteId, authorPubkey, fetched?.authorEdits ?? [])
    return this.commitState(noteId, merged)
  }

  private async fetchFromRelays(
    noteId: string,
    authorPubkey: string,
    relays: string[]
  ): Promise<ShortNoteEditState | undefined> {
    if (relays.length === 0) return undefined

    const filter = this.editsFilter(noteId)
    const relayEdits = await queryService.fetchEvents(relays, filter)
    for (const edit of relayEdits) {
      client.addEventToCache(edit)
      this.indexArchiveEdit(edit)
    }

    const state = buildShortNoteEditState(relayEdits, this.kind1Stub(noteId, authorPubkey))
    return state.authorEdits.length > 0 ? state : undefined
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
