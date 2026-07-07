import { fetchWebMetadataCached, webMetadataCacheStatus } from '@/lib/web-metadata-cache'
import { TWebMetadata } from '@/types'
import { useEffect, useState } from 'react'
import logger from '@/lib/logger'
import { isLikelyWebPageUrl } from '@/lib/url'

export function useFetchWebMetadata(
  url: string,
  options?: { /** When false, skip OG fetch (caller already has metadata or URL is not a web page). */ fetchEnabled?: boolean }
) {
  const fetchEnabled = options?.fetchEnabled !== false
  const [metadata, setMetadata] = useState<TWebMetadata>({})
  const [ogLoading, setOgLoading] = useState(() =>
    Boolean(fetchEnabled && url && isLikelyWebPageUrl(url))
  )

  useEffect(() => {
    if (!fetchEnabled || !url || !isLikelyWebPageUrl(url)) {
      setMetadata({})
      setOgLoading(false)
      return
    }

    let cancelled = false
    const cacheStatus = webMetadataCacheStatus(url)
    if (cacheStatus === 'miss') {
      logger.debug('[useFetchWebMetadata] Fetching OG metadata', { url })
    }

    setOgLoading(true)
    if (cacheStatus === 'miss') {
      setMetadata({})
    }

    fetchWebMetadataCached(url)
      .then((metadata) => {
        if (cancelled) return
        if (cacheStatus === 'miss') {
          logger.debug('[useFetchWebMetadata] Received metadata', {
            url,
            hasTitle: !!metadata.title,
            hasDescription: !!metadata.description,
            hasImage: !!metadata.image
          })
        }
        setMetadata(metadata)
      })
      .catch((error) => {
        if (cancelled) return
        logger.debug('[useFetchWebMetadata] Failed to fetch metadata', { url, error })
      })
      .finally(() => {
        if (!cancelled) setOgLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url, fetchEnabled])

  return { ...metadata, ogLoading }
}
