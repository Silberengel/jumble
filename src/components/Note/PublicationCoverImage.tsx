import { useNearViewport } from '@/hooks/useNearViewport'
import { gutenbergCoverCandidateUrls } from '@/lib/gutenberg-cover'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from '../Image'
import PublicationCoverFallback from './PublicationCoverFallback'

/** Max cover height in the library grid (3-column cards). */
export const LIBRARY_PUBLICATION_COVER_MAX_CLASS = 'max-h-48'

/** Max cover box in publication detail / note panel (larger axis capped at 400px). */
export const PUBLICATION_COVER_MAX_CLASS = 'max-h-[400px] max-w-[400px]'

export default function PublicationCoverImage({
  imageUrl,
  pubkey,
  autoLoadMedia,
  size = 'default',
  layout = 'stacked',
  className
}: {
  imageUrl: string
  pubkey: string
  autoLoadMedia: boolean
  size?: 'library' | 'default'
  layout?: 'stacked' | 'row'
  className?: string
}) {
  const isLibrary = size === 'library'
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isNearViewport = useNearViewport(wrapperRef, { enabled: isLibrary })
  const maxClass = isLibrary ? LIBRARY_PUBLICATION_COVER_MAX_CLASS : PUBLICATION_COVER_MAX_CLASS
  const candidateUrls = useMemo(
    () => gutenbergCoverCandidateUrls(imageUrl, isLibrary),
    [imageUrl, isLibrary]
  )
  const [urlIndex, setUrlIndex] = useState(0)
  const [exhausted, setExhausted] = useState(false)
  const activeUrl = candidateUrls[urlIndex] ?? candidateUrls[0] ?? imageUrl.trim()

  useEffect(() => {
    setUrlIndex(0)
    setExhausted(false)
  }, [imageUrl, isLibrary])

  const handleImageError = useCallback(() => {
    setUrlIndex((index) => {
      const next = index + 1
      if (next < candidateUrls.length) return next
      setExhausted(true)
      return index
    })
  }, [candidateUrls.length])

  if (exhausted || !activeUrl) {
    return <PublicationCoverFallback layout={layout} size={size} className={className} />
  }

  const stackedLayoutClass = isLibrary ? 'aspect-[3/4] w-full' : 'w-fit'

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted',
        maxClass,
        layout === 'stacked' ? stackedLayoutClass : 'aspect-[3/4] w-full max-w-[9rem] sm:max-w-[10rem]',
        layout === 'stacked' && size === 'default' && 'mb-3',
        layout === 'stacked' && isLibrary && 'mb-2',
        className
      )}
    >
      {isNearViewport ? (
        <Image
          key={activeUrl}
          image={{ url: activeUrl, pubkey }}
          className={cn(
            maxClass,
            isLibrary ? 'max-w-full object-contain' : 'h-auto w-auto max-w-full object-contain'
          )}
          classNames={{ wrapper: isLibrary ? 'block w-full max-w-full' : 'block w-fit max-w-full' }}
          hideIfError
          onFinalError={handleImageError}
          holdUntilClick={!autoLoadMedia}
          loading={isLibrary ? 'lazy' : 'eager'}
          fetchPriority={isLibrary ? 'low' : undefined}
        />
      ) : null}
    </div>
  )
}
