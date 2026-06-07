import { useNearViewport } from '@/hooks/useNearViewport'
import { gutenbergLibraryCoverImageUrl } from '@/lib/gutenberg-cover'
import { cn } from '@/lib/utils'
import { useRef } from 'react'
import Image from '../Image'

/** Max cover height in the library grid (3-column cards). */
export const LIBRARY_PUBLICATION_COVER_MAX_CLASS = 'max-h-48'

/** Max cover height in publication detail / default cards. */
export const PUBLICATION_COVER_MAX_CLASS = 'max-h-[400px]'

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
  const resolvedUrl = isLibrary ? gutenbergLibraryCoverImageUrl(imageUrl) : imageUrl

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted',
        maxClass,
        layout === 'stacked' ? 'aspect-[3/4] w-full' : 'aspect-[3/4] w-full max-w-[9rem] sm:max-w-[10rem]',
        layout === 'stacked' && size === 'default' && 'mb-3',
        layout === 'stacked' && isLibrary && 'mb-2',
        className
      )}
    >
      {isNearViewport ? (
        <Image
          image={{ url: resolvedUrl, pubkey }}
          className={cn(maxClass, 'max-w-full object-contain')}
          classNames={{ wrapper: 'block w-full max-w-full' }}
          hideIfError
          holdUntilClick={!autoLoadMedia}
          loading={isLibrary ? 'lazy' : 'eager'}
          fetchPriority={isLibrary ? 'low' : undefined}
        />
      ) : null}
    </div>
  )
}
