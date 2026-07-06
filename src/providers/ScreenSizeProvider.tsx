import { createContext, useContext, useEffect, useState } from 'react'

type TScreenSizeContext = {
  isSmallScreen: boolean
  isLargeScreen: boolean
}

const ScreenSizeContext = createContext<TScreenSizeContext | undefined>(undefined)

const SMALL_SCREEN_MQ = '(max-width: 768px)'
const LARGE_SCREEN_MQ = '(min-width: 1280px)'

/** Layout breakpoints follow the CSS viewport (matchMedia), not `window.innerWidth` — Firefox/Chrome responsive mode emulates width without changing innerWidth. */
function readScreenSizeFlags(): Pick<TScreenSizeContext, 'isSmallScreen' | 'isLargeScreen'> {
  return {
    isSmallScreen: window.matchMedia(SMALL_SCREEN_MQ).matches,
    isLargeScreen: window.matchMedia(LARGE_SCREEN_MQ).matches
  }
}

/** Fallback when rendering outside {@link ScreenSizeProvider} (embedded notes, portals). */
export function getScreenSizeSnapshot(): TScreenSizeContext {
  if (typeof window === 'undefined') {
    return { isSmallScreen: false, isLargeScreen: false }
  }
  return readScreenSizeFlags()
}

export const useScreenSize = () => {
  const context = useContext(ScreenSizeContext)
  if (!context) {
    throw new Error('useScreenSize must be used within a ScreenSizeProvider')
  }
  return context
}

/** Returns undefined when outside provider (e.g. embedded notes in createRoot trees). */
export function useScreenSizeOptional(): TScreenSizeContext | undefined {
  return useContext(ScreenSizeContext)
}

export function ScreenSizeProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState(readScreenSizeFlags)

  useEffect(() => {
    const smallMq = window.matchMedia(SMALL_SCREEN_MQ)
    const largeMq = window.matchMedia(LARGE_SCREEN_MQ)
    const sync = () => setFlags(readScreenSizeFlags())

    smallMq.addEventListener('change', sync)
    largeMq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)

    return () => {
      smallMq.removeEventListener('change', sync)
      largeMq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
    }
  }, [])

  return (
    <ScreenSizeContext.Provider
      value={{
        isSmallScreen: flags.isSmallScreen,
        isLargeScreen: flags.isLargeScreen
      }}
    >
      {children}
    </ScreenSizeContext.Provider>
  )
}
