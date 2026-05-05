import { createContext, useContext, type ReactNode, type RefObject } from 'react'

const PrimaryPageScrollAreaRefContext = createContext<RefObject<HTMLDivElement | null> | null>(null)

/**
 * The desktop primary column’s main `overflow-y: auto` node (see {@link PrimaryPageLayout}).
 * Feeds use this so {@link VirtualizedFeedRows} observes the same scrollport the user actually scrolls.
 */
export function PrimaryPageScrollAreaRefProvider({
  scrollAreaRef,
  children
}: {
  scrollAreaRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  return (
    <PrimaryPageScrollAreaRefContext.Provider value={scrollAreaRef}>
      {children}
    </PrimaryPageScrollAreaRefContext.Provider>
  )
}

export function usePrimaryPageScrollAreaRefOptional(): RefObject<HTMLDivElement | null> | null {
  return useContext(PrimaryPageScrollAreaRefContext)
}
