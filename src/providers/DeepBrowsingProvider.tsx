import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

type TDeepBrowsingContext = {
  deepBrowsing: boolean
  /** Latest scrollTop without triggering context re-renders on every scroll tick. */
  getLastScrollTop: () => number
}

const DeepBrowsingContext = createContext<TDeepBrowsingContext | undefined>(undefined)

export const useDeepBrowsing = () => {
  const context = useContext(DeepBrowsingContext)
  if (!context) {
    throw new Error('useDeepBrowsing must be used within a DeepBrowsingProvider')
  }
  return context
}

export function DeepBrowsingProvider({
  children,
  active,
  scrollAreaRef
}: {
  children: React.ReactNode
  active: boolean
  scrollAreaRef?: React.RefObject<HTMLDivElement>
}) {
  const [deepBrowsing, setDeepBrowsing] = useState(false)
  const lastScrollTopRef = useRef(
    (!scrollAreaRef ? window.scrollY : scrollAreaRef.current?.scrollTop) || 0
  )
  /**
   * Chrome (especially installed PWA) fires scroll when we restore `scrollTop` programmatically.
   * That one-shot jump looks like "deep browse" and hid sticky tab rows via translate. Firefox often
   * does not surface the same scroll event pattern on restore.
   */
  const ignoreScrollForDeepBrowseRef = useRef(true)

  useEffect(() => {
    if (!active) return

    ignoreScrollForDeepBrowseRef.current = true
    setDeepBrowsing(false)
    const syncScrollTop = () => {
      lastScrollTopRef.current =
        (!scrollAreaRef ? window.scrollY : scrollAreaRef.current?.scrollTop) || 0
    }
    syncScrollTop()
    const graceTimer = window.setTimeout(() => {
      ignoreScrollForDeepBrowseRef.current = false
      syncScrollTop()
    }, 150)

    let rafId: number | null = null
    const handleScroll = () => {
      // Use requestAnimationFrame to throttle scroll updates and prevent scroll-linked positioning warnings
      if (rafId !== null) return

      rafId = requestAnimationFrame(() => {
        const scrollTop = (!scrollAreaRef ? window.scrollY : scrollAreaRef.current?.scrollTop) || 0
        const diff = scrollTop - lastScrollTopRef.current
        lastScrollTopRef.current = scrollTop

        if (ignoreScrollForDeepBrowseRef.current) {
          rafId = null
          return
        }

        if (scrollTop <= 800) {
          setDeepBrowsing(false)
          rafId = null
          return
        }

        if (diff > 20) {
          setDeepBrowsing(true)
        } else if (diff < -20) {
          setDeepBrowsing(false)
        }
        rafId = null
      })
    }

    const target = scrollAreaRef ? scrollAreaRef.current : window

    target?.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.clearTimeout(graceTimer)
      target?.removeEventListener('scroll', handleScroll)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [active, scrollAreaRef])

  const value = useMemo(
    () => ({
      deepBrowsing,
      getLastScrollTop: () => lastScrollTopRef.current
    }),
    [deepBrowsing]
  )

  return <DeepBrowsingContext.Provider value={value}>{children}</DeepBrowsingContext.Provider>
}
