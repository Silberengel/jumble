import { PROFILE_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import client from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState } from 'react'

const PROFILE_SEARCH_RELAY_URLS = Array.from(
  new Set(PROFILE_RELAY_URLS.map((u) => normalizeUrl(u) || u).filter(Boolean))
)

export function useSearchProfiles(search: string, limit: number) {
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [profiles, setProfiles] = useState<TProfile[]>([])

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!search.trim()) {
        setProfiles([])
        setIsFetching(false)
        return
      }

      setIsFetching(true)
      setProfiles([])
      try {
        const profiles = await client.searchProfilesFromLocal(search, limit)
        setProfiles(profiles)
        if (profiles.length >= limit) {
          return
        }
        const existingPubkeys = new Set(profiles.map((profile) => profile.pubkey))
        const fetchedProfiles = await client.searchProfiles(PROFILE_SEARCH_RELAY_URLS, {
          search,
          limit
        })
        if (fetchedProfiles.length) {
          fetchedProfiles.forEach((profile) => {
            if (existingPubkeys.has(profile.pubkey)) {
              return
            }
            existingPubkeys.add(profile.pubkey)
            profiles.push(profile)
          })
          setProfiles([...profiles])
        }
      } catch (err) {
        setError(err as Error)
      } finally {
        setIsFetching(false)
      }
    }

    fetchProfiles()
  }, [search, limit])

  return { isFetching, error, profiles }
}
