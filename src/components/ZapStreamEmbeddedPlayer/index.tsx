import { canonicalZapStreamWatchUrl } from '@/lib/zap-stream-url'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useLayoutEffect, useMemo, useState } from 'react'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'

export default function ZapStreamEmbeddedPlayer({
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
  const embedSrc = useMemo(() => canonicalZapStreamWatchUrl(url), [url])
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
        src={embedSrc}
        mediaKind="video"
        onActivate={() => setUserClickedLoad(true)}
        className={cn('aspect-video max-h-[min(70vh,28rem)]', className)}
      />
    )
  }

  return (
    <iframe
      title="zap.stream"
      src={embedSrc}
      className={cn(
        'not-prose rounded-lg border w-full max-w-[400px] aspect-video max-h-[min(70vh,28rem)]',
        className
      )}
      allow="autoplay; encrypted-media; fullscreen; clipboard-write"
      allowFullScreen
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  )
}
