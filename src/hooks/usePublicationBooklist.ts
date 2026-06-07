import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import {
  dispatchBooklistLabelUpdated,
  fetchUserBooklistLabelForPublication,
  findSessionBooklistLabelForPublication
} from '@/lib/booklist-label'
import { createBooklistLabelDraftEvent } from '@/lib/draft-event'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function usePublicationBooklist(publication: Event) {
  const { t } = useTranslation()
  const { pubkey, publish, attemptDelete, checkLogin, canManageIdentity } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [labelEvent, setLabelEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState(false)

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setLabelEvent(null)
      return
    }
    const session = findSessionBooklistLabelForPublication(pubkey, publication)
    if (session) {
      setLabelEvent(session)
      return
    }
    setLoading(true)
    try {
      const relays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      const found = await fetchUserBooklistLabelForPublication(pubkey, publication, relays)
      setLabelEvent(found)
    } finally {
      setLoading(false)
    }
  }, [pubkey, publication, favoriteRelays, blockedRelays])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onUpdated = (e: globalThis.Event) => {
      const detail = (e as CustomEvent<{ publicationId?: string }>).detail
      if (detail?.publicationId === publication.id) {
        void refresh()
      }
    }
    window.addEventListener('booklist-label-updated', onUpdated as EventListener)
    return () => window.removeEventListener('booklist-label-updated', onUpdated as EventListener)
  }, [publication.id, refresh])

  const toggle = useCallback(async () => {
    await checkLogin(async () => {
      if (toggling) return
      setToggling(true)
      try {
        if (labelEvent) {
          await attemptDelete(labelEvent)
          setLabelEvent(null)
          dispatchBooklistLabelUpdated(publication)
          toast.success(t('Removed from my booklist'))
        } else {
          const draft = createBooklistLabelDraftEvent(publication)
          const published = await publish(draft)
          setLabelEvent(published)
          dispatchBooklistLabelUpdated(publication)
          toast.success(t('Added to my booklist'))
        }
      } catch (err) {
        toast.error(
          (labelEvent ? t('Remove from my booklist failed') : t('Add to my booklist failed')) +
            ': ' +
            (err instanceof Error ? err.message : String(err))
        )
      } finally {
        setToggling(false)
      }
    })
  }, [attemptDelete, checkLogin, labelEvent, publication, publish, t, toggling])

  return {
    isOnBooklist: !!labelEvent,
    loading,
    toggling,
    toggle,
    canToggle: canManageIdentity
  }
}
