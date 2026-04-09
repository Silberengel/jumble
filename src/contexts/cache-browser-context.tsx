import CacheBrowserDialog from '../components/CacheBrowser/CacheBrowserDialog'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type CacheBrowserContextValue = {
  openBrowseCache: () => void
}

const CacheBrowserContext = createContext<CacheBrowserContextValue | undefined>(undefined)

export function CacheBrowserProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openBrowseCache = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ openBrowseCache }), [openBrowseCache])

  return (
    <CacheBrowserContext.Provider value={value}>
      {children}
      <CacheBrowserDialog open={open} onOpenChange={setOpen} />
    </CacheBrowserContext.Provider>
  )
}

export function useCacheBrowser(): CacheBrowserContextValue {
  const ctx = useContext(CacheBrowserContext)
  if (!ctx) {
    throw new Error('useCacheBrowser must be used within CacheBrowserProvider')
  }
  return ctx
}
