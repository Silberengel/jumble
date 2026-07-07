import type { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'

const MediaAutoLoadEventContext = createContext<Event | null>(null)

/** When true, OP/detail views load all media immediately (user already opened the note). */
const MediaForceAutoLoadContext = createContext(false)

/** Supplies the note/event being rendered so media policy can respect content warnings. */
export function MediaAutoLoadEventProvider({
  event,
  children
}: {
  event: Event
  children: React.ReactNode
}) {
  return (
    <MediaAutoLoadEventContext.Provider value={event}>{children}</MediaAutoLoadEventContext.Provider>
  )
}

export function MediaForceAutoLoadProvider({
  force,
  children
}: {
  force: boolean
  children: React.ReactNode
}) {
  return (
    <MediaForceAutoLoadContext.Provider value={force}>{children}</MediaForceAutoLoadContext.Provider>
  )
}

export function useMediaAutoLoadSourceEvent(): Event | null {
  return useContext(MediaAutoLoadEventContext)
}

export function useMediaForceAutoLoad(): boolean {
  return useContext(MediaForceAutoLoadContext)
}
