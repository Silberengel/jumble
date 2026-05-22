import CacheBrowserDialog from '../components/CacheBrowser/CacheBrowserDialog'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

type CacheBrowserContextValue = {
  openBrowseCache: () => void
}

const CacheBrowserContext = createContext<CacheBrowserContextValue | undefined>(undefined)

/** Survives React Fast Refresh when context hooks temporarily lose their provider. */
let browseCacheOpener: (() => void) | null = null

export function registerBrowseCacheOpener(fn: (() => void) | null): void {
  browseCacheOpener = fn
}

/** Open the cache browser dialog when the provider is mounted; safe during HMR. */
export function openBrowseCacheFromRegistry(): boolean {
  if (!browseCacheOpener) return false
  browseCacheOpener()
  return true
}

export function CacheBrowserProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openBrowseCache = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ openBrowseCache }), [openBrowseCache])

  useEffect(() => {
    registerBrowseCacheOpener(openBrowseCache)
    return () => registerBrowseCacheOpener(null)
  }, [openBrowseCache])

  return (
    <CacheBrowserContext.Provider value={value}>
      {children}
      <CacheBrowserDialog open={open} onOpenChange={setOpen} />
    </CacheBrowserContext.Provider>
  )
}

export function useCacheBrowserOptional(): CacheBrowserContextValue | undefined {
  return useContext(CacheBrowserContext)
}

export function useCacheBrowser(): CacheBrowserContextValue {
  const ctx = useCacheBrowserOptional()
  if (!ctx) {
    throw new Error('useCacheBrowser must be used within CacheBrowserProvider')
  }
  return ctx
}
