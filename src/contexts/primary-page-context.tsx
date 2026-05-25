import { createContext, useContext } from 'react'
import type { TPrimaryPageName } from '@/PageManager'

/**
 * Lives in a dedicated module so lazy chunks (e.g. Sidebar) share the same context instance as
 * PageManager. Importing `usePrimaryPage` from PageManager into those chunks can duplicate the
 * module and break Provider matching ("must be used within PrimaryPageContext.Provider").
 * Use `import type` only so this file does not create a runtime dependency on PageManager.
 */
export type PrimaryPageContextValue = {
  navigate: (page: TPrimaryPageName, props?: object) => void
  current: TPrimaryPageName | null
  /** Props passed to the current primary page (e.g. `{ spell: 'discussions' }` for spells). */
  currentPageProps: object | undefined
  /**
   * False while a full-screen mobile overlay or note drawer covers the feed (primary unmounted).
   * True on desktop double-pane and when mobile secondary pages overlay the frozen feed.
   */
  display: boolean
  /**
   * True while any secondary panel, note drawer, or mobile overlay is open: pause primary feed
   * timelines / background stats and abort non-foreground relay queries.
   */
  frozen: boolean
}

export const PrimaryPageContext = createContext<PrimaryPageContextValue | undefined>(undefined)

export function usePrimaryPage(): PrimaryPageContextValue {
  const context = useContext(PrimaryPageContext)
  if (!context) {
    throw new Error('usePrimaryPage must be used within a PrimaryPageContext.Provider')
  }
  return context
}

/** Returns undefined when outside provider (e.g. embedded notes in createRoot trees). */
export function usePrimaryPageOptional(): PrimaryPageContextValue | undefined {
  return useContext(PrimaryPageContext)
}
