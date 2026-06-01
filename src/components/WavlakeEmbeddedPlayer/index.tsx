import {
  isWavlakeOpenUrl,
  wavlakeEmbedMinHeight,
  wavlakeOpenUrlToEmbedSrc
} from '@/lib/wavlake-url'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useLayoutEffect, useMemo, useState } from 'react'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'

export default function WavlakeEmbeddedPlayer({
  url,
  className,
  mustLoad = false
}: {
  url: string
  className?: string
  mustLoad?: boolean
}) {
  const contentPolicy = useContentPolicyOptional()
  const autoLoadMedia = contentPolicy?.autoLoadMedia ?? true
  const [userClickedLoad, setUserClickedLoad] = useState(false)
  const embedSrc = useMemo(() => wavlakeOpenUrlToEmbedSrc(url), [url])
  const minHeight = useMemo(() => wavlakeEmbedMinHeight(url), [url])
  const minHeightClass = minHeight === 200 ? 'min-h-[200px]' : 'min-h-[380px]'
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
      title="Wavlake"
      src={embedSrc}
      className={cn('w-full max-w-[400px] rounded-lg border', minHeightClass, className)}
      style={{ height: minHeight }}
      allow="autoplay; encrypted-media; clipboard-write"
      loading="lazy"
    />
  )
}

export { isWavlakeOpenUrl }
