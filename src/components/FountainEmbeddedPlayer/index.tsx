import ExternalLink from '../ExternalLink'
import MediaPlayer from '../MediaPlayer'
import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import {
  fountainDisplayTitleFromOgTitle,
  fountainEmbedMinHeight,
  isFountainOpenUrl
} from '@/lib/fountain-url'
import { cleanUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { Skeleton } from '@/components/ui/skeleton'
import { useLayoutEffect, useMemo, useState } from 'react'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'
import { ExternalLink as ExternalLinkIcon } from 'lucide-react'

function FountainCover({ url, className }: { url: string; className?: string }) {
  return (
    <div className={cn('w-full overflow-hidden bg-muted', className)}>
      <img
        src={url}
        alt=""
        className="aspect-[2/1] max-h-36 w-full object-cover object-center"
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
      />
    </div>
  )
}

function FountainMeta({
  displayTitle,
  cleanedUrl,
  compact = false
}: {
  displayTitle?: string | null
  cleanedUrl: string
  compact?: boolean
}) {
  return (
    <div className={cn('min-w-0 px-3', compact ? 'py-2' : 'pb-2 pt-2.5')}>
      {displayTitle ? (
        <p className="line-clamp-2 text-sm font-medium leading-snug">{displayTitle}</p>
      ) : (
        <p className="text-sm font-medium">fountain.fm</p>
      )}
      <a
        href={cleanedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">Open on Fountain</span>
        <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
      </a>
    </div>
  )
}

const cardShell = (className?: string) =>
  cn(
    'not-prose w-full max-w-[400px] overflow-hidden rounded-lg border border-border bg-muted/30 shadow-sm',
    className
  )

export default function FountainEmbeddedPlayer({
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
  const cleanedUrl = useMemo(() => cleanUrl(url) || url, [url])
  const minHeight = useMemo(() => fountainEmbedMinHeight(cleanedUrl), [cleanedUrl])
  const minHeightClass = minHeight === 200 ? 'min-h-[120px]' : 'min-h-[88px]'
  const showPlayer = mustLoad || autoLoadMedia || userClickedLoad

  const { title, image, audio, ogLoading } = useFetchWebMetadata(cleanedUrl, {
    fetchEnabled: showPlayer
  })

  const displayTitle = useMemo(() => fountainDisplayTitleFromOgTitle(title) ?? title, [title])

  useLayoutEffect(() => {
    if (!autoLoadMedia) setUserClickedLoad(false)
  }, [autoLoadMedia])

  if (!isFountainOpenUrl(cleanedUrl)) {
    return <ExternalLink url={url} />
  }

  if (!showPlayer) {
    return (
      <LazyMediaTapPlaceholder
        src={cleanedUrl}
        posterUrl={image ?? undefined}
        mediaKind="audio"
        onActivate={() => setUserClickedLoad(true)}
        className={cn('w-full max-w-[400px]', minHeightClass, className)}
      />
    )
  }

  if (ogLoading) {
    return (
      <div className={cn(cardShell(className), minHeightClass)}>
        <Skeleton className="aspect-[2/1] max-h-36 w-full rounded-none" />
        <Skeleton className="mx-3 mt-2 h-4 w-3/4" />
        <Skeleton className="mx-3 mt-1 h-8 w-full" />
      </div>
    )
  }

  if (!audio) {
    return (
      <div className={cn(cardShell(className))}>
        {image ? <FountainCover url={image} /> : null}
        <FountainMeta displayTitle={displayTitle} cleanedUrl={cleanedUrl} />
      </div>
    )
  }

  return (
    <div className={cardShell(className)}>
      {image ? <FountainCover url={image} /> : null}
      <FountainMeta displayTitle={displayTitle} cleanedUrl={cleanedUrl} compact />
      <MediaPlayer
        src={audio}
        className="w-full max-w-none shrink-0 border-0 border-t border-border px-2 pb-2 pt-1"
        mustLoad={showPlayer}
      />
    </div>
  )
}
