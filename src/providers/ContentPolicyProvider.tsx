import { resolveGlobalAutoLoadMedia } from '@/lib/media-auto-load-policy'
import storage from '@/services/local-storage.service'
import { TMediaAutoLoadPolicy } from '@/types'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type TContentPolicyContext = {
  autoplay: boolean
  setAutoplay: (autoplay: boolean) => void

  defaultShowNsfw: boolean
  setDefaultShowNsfw: (showNsfw: boolean) => void

  hideContentMentioningMutedUsers?: boolean
  setHideContentMentioningMutedUsers?: (hide: boolean) => void

  autoLoadMedia: boolean
  mediaAutoLoadPolicy: TMediaAutoLoadPolicy
  setMediaAutoLoadPolicy: (policy: TMediaAutoLoadPolicy) => void
  /** From the Network Information API when available (`undefined` on most desktop browsers). */
  connectionType: string | undefined

  /** True when `navigator.onLine` is false or the connection type is 'none'. */
  isOffline: boolean
}

const ContentPolicyContext = createContext<TContentPolicyContext | undefined>(undefined)

export const useContentPolicy = () => {
  const context = useContext(ContentPolicyContext)
  if (!context) {
    throw new Error('useContentPolicy must be used within an ContentPolicyProvider')
  }
  return context
}

/** Returns undefined when outside provider (e.g. embedded notes in createRoot trees). */
export function useContentPolicyOptional(): TContentPolicyContext | undefined {
  return useContext(ContentPolicyContext)
}

export function ContentPolicyProvider({ children }: { children: React.ReactNode }) {
  const [autoplay, setAutoplay] = useState(storage.getAutoplay())
  const [defaultShowNsfw, setDefaultShowNsfw] = useState(storage.getDefaultShowNsfw())
  const [hideContentMentioningMutedUsers, setHideContentMentioningMutedUsers] = useState(
    storage.getHideContentMentioningMutedUsers()
  )
  const [mediaAutoLoadPolicy, setMediaAutoLoadPolicy] = useState(storage.getMediaAutoLoadPolicy())
  const [connectionType, setConnectionType] = useState((navigator as any).connection?.type)
  const [isOffline, setIsOffline] = useState(
    () => !navigator.onLine || (navigator as any).connection?.type === 'none'
  )

  useEffect(() => {
    const connection = (navigator as any).connection

    const refresh = () => {
      const conn = (navigator as any).connection
      setConnectionType(conn?.type)
      setIsOffline(!navigator.onLine || conn?.type === 'none')
    }

    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    connection?.addEventListener('change', refresh)

    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      connection?.removeEventListener('change', refresh)
    }
  }, [])

  const autoLoadMedia = useMemo(
    () => resolveGlobalAutoLoadMedia(mediaAutoLoadPolicy, connectionType),
    [mediaAutoLoadPolicy, connectionType]
  )

  const updateAutoplay = useCallback((autoplay: boolean) => {
    storage.setAutoplay(autoplay)
    setAutoplay(autoplay)
  }, [])

  const updateDefaultShowNsfw = useCallback((defaultShowNsfw: boolean) => {
    storage.setDefaultShowNsfw(defaultShowNsfw)
    setDefaultShowNsfw(defaultShowNsfw)
  }, [])

  const updateHideContentMentioningMutedUsers = useCallback((hide: boolean) => {
    storage.setHideContentMentioningMutedUsers(hide)
    setHideContentMentioningMutedUsers(hide)
  }, [])

  const updateMediaAutoLoadPolicy = useCallback((policy: TMediaAutoLoadPolicy) => {
    storage.setMediaAutoLoadPolicy(policy)
    // Defer React state: Radix Select fires onValueChange while its portal is still unmounting.
    // An immediate full-tree re-render (feed + body portals) races removeChild and throws.
    const run = () => setMediaAutoLoadPolicy(policy)
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(run, 0)
    } else {
      run()
    }
  }, [])

  const contextValue = useMemo(
    () => ({
      autoplay,
      setAutoplay: updateAutoplay,
      defaultShowNsfw,
      setDefaultShowNsfw: updateDefaultShowNsfw,
      hideContentMentioningMutedUsers,
      setHideContentMentioningMutedUsers: updateHideContentMentioningMutedUsers,
      autoLoadMedia,
      mediaAutoLoadPolicy,
      setMediaAutoLoadPolicy: updateMediaAutoLoadPolicy,
      connectionType,
      isOffline
    }),
    [
      autoplay,
      updateAutoplay,
      defaultShowNsfw,
      updateDefaultShowNsfw,
      hideContentMentioningMutedUsers,
      updateHideContentMentioningMutedUsers,
      autoLoadMedia,
      mediaAutoLoadPolicy,
      updateMediaAutoLoadPolicy,
      connectionType,
      isOffline
    ]
  )

  return (
    <ContentPolicyContext.Provider value={contextValue}>
      {children}
    </ContentPolicyContext.Provider>
  )
}
