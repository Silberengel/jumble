import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { spotifyOpenUrlToEmbedSrc } from '@/lib/spotify-url'
import { cn } from '@/lib/utils'
import { useLayoutEffect, useMemo, useState } from 'react'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'

export default function SpotifyEmbeddedPlayer({
  url,
  className,
  mustLoad = false,
  authorPubkey
}: {
  url: string
  className?: string
  mustLoad?: boolean
  authorPubkey?: string | null
}) {
  const autoLoadMedia = useShouldAutoLoadMedia(authorPubkey)
  const [userClickedLoad, setUserClickedLoad] = useState(false)
  const embedSrc = useMemo(() => spotifyOpenUrlToEmbedSrc(url), [url])
  const showEmbed = mustLoad || autoLoadMedia || userClickedLoad

  useLayoutEffect(() => {
    if (!autoLoadMedia) setUserClickedLoad(false)
  }, [autoLoadMedia])

  if (!embedSrc) {
    return <ExternalLink url={url} />
  }

  if (!mustLoad && !showEmbed) {
    return (
      <LazyMediaTapPlaceholder
        src={url}
        mediaKind="audio"
        onActivate={() => setUserClickedLoad(true)}
        className={cn('min-h-[152px]', className)}
      />
    )
  }

  return (
    <iframe
      title="Spotify"
      src={embedSrc}
      className={cn('rounded-lg border w-full max-w-[400px] min-h-[152px]', className)}
      allow="encrypted-media; clipboard-write"
      loading="lazy"
    />
  )
}
