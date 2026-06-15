import type { Event } from 'nostr-tools'
import { useSyncExternalStore } from 'react'

export type NoteTranslationEntry = {
  /** LibreTranslate `target` code (from `/languages`). */
  lang: string
  /** Human label from the translate service (read-aloud fallback when not an app UI locale). */
  langLabel?: string
  content: string
  /** When present, replaces or inserts a `title` tag (articles, discussions, web bookmarks). */
  title?: string
  /** NIP-84 kind 9802: translated `context` tag body (full quoted passage). */
  context?: string
  /** NIP-84 kind 9802: translated `textquoteselector` prefix. */
  textQuotePrefix?: string
  /** NIP-84 kind 9802: translated `textquoteselector` suffix. */
  textQuoteSuffix?: string
  /**
   * Related notes (parent preview, embedded) translated in the same action as this note.
   * Cleared together when the user chooses “show original” on this note.
   */
  coTranslatedIds?: string[]
}

const map = new Map<string, NoteTranslationEntry>()
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export function subscribeNoteTranslations(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

export function setNoteTranslation(eventId: string, entry: NoteTranslationEntry): void {
  map.set(eventId, entry)
  emit()
}

export function clearNoteTranslation(eventId: string): void {
  const entry = map.get(eventId)
  if (entry?.coTranslatedIds?.length) {
    for (const id of entry.coTranslatedIds) {
      map.delete(id)
    }
  }
  map.delete(eventId)
  emit()
}

export function getNoteTranslation(eventId: string): NoteTranslationEntry | undefined {
  return map.get(eventId)
}

export function useNoteTranslation(eventId: string): NoteTranslationEntry | undefined {
  return useSyncExternalStore(
    subscribeNoteTranslations,
    () => map.get(eventId),
    () => map.get(eventId)
  )
}

function patchTitleInTagsCopy(tags: string[][], title: string): string[][] {
  const out = tags.map((row) => row.slice())
  const i = out.findIndex((r) => r[0] === 'title')
  if (i >= 0) out[i] = ['title', title]
  else out.unshift(['title', title])
  return out
}

function patchContextInTagsCopy(tags: string[][], context: string): string[][] {
  const out = tags.map((row) => row.slice())
  const i = out.findIndex((r) => r[0] === 'context')
  if (i >= 0) out[i] = ['context', context]
  else out.push(['context', context])
  return out
}

function patchTextQuoteSelectorInTagsCopy(
  tags: string[][],
  prefix?: string,
  suffix?: string
): string[][] {
  const out = tags.map((row) => row.slice())
  const i = out.findIndex((r) => r[0] === 'textquoteselector')
  if (i < 0) return out
  const row = out[i]!
  if (row.length >= 4 && row[1] === '-') {
    if (prefix !== undefined) row[2] = prefix
    if (suffix !== undefined) row[3] = suffix
  } else if (row.length >= 3) {
    if (prefix !== undefined) row[1] = prefix
    if (suffix !== undefined) row[2] = suffix
  }
  return out
}

/** Event with translated `content` / optional `title` tag for body renderers. */
export function mergeTranslatedNote(event: Event, tr?: NoteTranslationEntry | null): Event {
  if (!tr) return event
  let tags = event.tags
  if (tr.title) tags = patchTitleInTagsCopy(tags, tr.title)
  if (tr.context) tags = patchContextInTagsCopy(tags, tr.context)
  if (tr.textQuotePrefix !== undefined || tr.textQuoteSuffix !== undefined) {
    tags = patchTextQuoteSelectorInTagsCopy(tags, tr.textQuotePrefix, tr.textQuoteSuffix)
  }
  return { ...event, content: tr.content, tags }
}
