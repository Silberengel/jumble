import logger from '@/lib/logger'
import client from '@/services/client.service'
import { TRelayList } from '@/types'
import { useEffect, useState } from 'react'

export function useFetchRelayList(pubkey?: string | null) {
  const [relayList, setRelayList] = useState<TRelayList>({
    write: [],
    read: [],
    originalRelays: [],
    httpRead: [],
    httpWrite: [],
    httpOriginalRelays: []
  })
  const [isFetching, setIsFetching] = useState(true)

  useEffect(() => {
    const fetchRelayList = async () => {
      setIsFetching(true)
      if (!pubkey) {
        setIsFetching(false)
        return
      }
      try {
        const fromStorage = await client.peekRelayListFromStorage(pubkey)
        setRelayList(fromStorage)
        const relayList = await client.fetchRelayList(pubkey)
        setRelayList(relayList)
      } catch (err) {
        logger.error('Failed to fetch relay list', { error: err, pubkey })
        try {
          setRelayList(await client.peekRelayListFromStorage(pubkey))
        } catch {
          /* keep last good state */
        }
      } finally {
        setIsFetching(false)
      }
    }

    fetchRelayList()
  }, [pubkey])

  return { relayList, isFetching }
}
