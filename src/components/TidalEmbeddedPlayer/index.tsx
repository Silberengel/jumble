import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import {
  tidalEmbedMinHeightClass,
  tidalOpenUrlToEmbedSrc
} from '@/lib/tidal-url'
import { cn } from '@/lib/utils'
import { useLayoutEffect, useMemo, useState } from 'react'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'

export default function TidalEmbeddedPlayer({
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
  const embedSrc = useMemo(() => tidalOpenUrlToEmbedSrc(url), [url])
  const minHeightClass = useMemo(() => tidalEmbedMinHeightClass(url), [url])
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
        className={cn('w-full max-w-[400px]', minHeightClass, className)}
      />
    )
  }

  return (
    <iframe
      title="TIDAL"
      src={embedSrc}
      className={cn('w-full max-w-[400px] rounded-lg border', minHeightClass, className)}
      allow="encrypted-media; fullscreen; clipboard-write https://embed.tidal.com; web-share"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      loading="lazy"
    />
  )
}
