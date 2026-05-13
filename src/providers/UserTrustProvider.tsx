import { getPubkeysFromPTags } from '@/lib/tag'
import storage from '@/services/local-storage.service'
import { replaceableEventService } from '@/services/client.service'
import { UserTrustContext } from '@/contexts/user-trust-context'
import { kinds } from 'nostr-tools'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useNostr } from './NostrProvider'

const wotSet = new Set<string>()

export function UserTrustProvider({ children }: { children: ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()
  const [isTrustLoaded, setIsTrustLoaded] = useState(false)
  const [hideUntrustedInteractions, setHideUntrustedInteractions] = useState(() =>
    storage.getHideUntrustedInteractions()
  )
  const [hideUntrustedNotifications, setHideUntrustedNotifications] = useState(() =>
    storage.getHideUntrustedNotifications()
  )
  const [hideUntrustedNotes, setHideUntrustedNotes] = useState(() =>
    storage.getHideUntrustedNotes()
  )

  useEffect(() => {
    if (!currentPubkey) {
      setIsTrustLoaded(false)
      return
    }

    // Clear wotSet when account changes to avoid cross-account contamination
    wotSet.clear()
    setIsTrustLoaded(false)

    const initWoT = async () => {
      try {
        const followListEvent = await replaceableEventService.fetchReplaceableEvent(currentPubkey, kinds.Contacts)
        const followings = followListEvent ? getPubkeysFromPTags(followListEvent.tags) : []
        followings.forEach((pubkey) => wotSet.add(pubkey.toLowerCase()))

        const batchSize = 20
        for (let i = 0; i < followings.length; i += batchSize) {
          const batch = followings.slice(i, i + batchSize)
          await Promise.allSettled(
            batch.map(async (pubkey) => {
              const innerFollow = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Contacts)
              const _followings = innerFollow ? getPubkeysFromPTags(innerFollow.tags) : []
              _followings.forEach((following) => {
                wotSet.add(following.toLowerCase())
              })
            })
          )
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      } finally {
        setIsTrustLoaded(true)
      }
    }
    void initWoT()
  }, [currentPubkey])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (!currentPubkey || pubkey.toLowerCase() === currentPubkey.toLowerCase()) return true
      return wotSet.has(pubkey.toLowerCase())
    },
    [currentPubkey]
  )

  const updateHideUntrustedInteractions = (hide: boolean) => {
    setHideUntrustedInteractions(hide)
    storage.setHideUntrustedInteractions(hide)
  }

  const updateHideUntrustedNotifications = (hide: boolean) => {
    setHideUntrustedNotifications(hide)
    storage.setHideUntrustedNotifications(hide)
  }

  const updateHideUntrustedNotes = (hide: boolean) => {
    setHideUntrustedNotes(hide)
    storage.setHideUntrustedNotes(hide)
  }

  return (
    <UserTrustContext.Provider
      value={{
        isTrustLoaded,
        hideUntrustedInteractions,
        hideUntrustedNotifications,
        hideUntrustedNotes,
        updateHideUntrustedInteractions,
        updateHideUntrustedNotifications,
        updateHideUntrustedNotes,
        isUserTrusted
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
