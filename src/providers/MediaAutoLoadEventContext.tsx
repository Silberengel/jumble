import type { Event } from 'nostr-tools'
import { createContext, useContext } from 'react'

const MediaAutoLoadEventContext = createContext<Event | null>(null)

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

export function useMediaAutoLoadSourceEvent(): Event | null {
  return useContext(MediaAutoLoadEventContext)
}
