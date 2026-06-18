import webService from '@/services/web.service'
import type { TWebMetadata } from '@/types'

const cache = new Map<string, TWebMetadata>()
const inflight = new Map<string, Promise<TWebMetadata>>()

/** Shared OG metadata fetch — dedupes in-flight and completed requests by URL. */
export function fetchWebMetadataCached(url: string): Promise<TWebMetadata> {
  const cached = cache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)

  const pending = inflight.get(url)
  if (pending) return pending

  const promise = webService
    .fetchWebMetadata(url)
    .then((metadata) => {
      cache.set(url, metadata)
      inflight.delete(url)
      return metadata
    })
    .catch((error) => {
      inflight.delete(url)
      throw error
    })

  inflight.set(url, promise)
  return promise
}
