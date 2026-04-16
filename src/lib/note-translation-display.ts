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

/** Event with translated `content` / optional `title` tag for body renderers. */
export function mergeTranslatedNote(event: Event, tr?: NoteTranslationEntry | null): Event {
  if (!tr) return event
  const tags = tr.title ? patchTitleInTagsCopy(event.tags, tr.title) : event.tags
  return { ...event, content: tr.content, tags }
}
