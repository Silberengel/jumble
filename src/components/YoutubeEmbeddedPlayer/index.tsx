import { ensureYouTubeIframeApi } from '@/lib/youtube-iframe-api'
import { parseYoutubeUrl } from '@/lib/youtube-url'
import { buildYoutubeTranscriptThirdPartyUrl } from '@/lib/youtube-transcript'
import { URI_LINK_CLASS } from '@/lib/link-styles'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { cn } from '@/lib/utils'
import mediaManager from '@/services/media-manager.service'
import { YouTubePlayer } from '@/types/youtube'
import { ExternalLink as ExternalLinkIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'
import logger from '@/lib/logger'

function YoutubePlayerShell({
  videoId,
  children
}: {
  videoId: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const transcriptUrl = buildYoutubeTranscriptThirdPartyUrl(videoId)

  return (
    <div className="not-prose w-full max-w-[400px] space-y-1">
      {children}
      <a
        href={transcriptUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          URI_LINK_CLASS,
          'inline-flex items-center gap-1.5 text-xs no-underline hover:underline'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
        {t('Open transcript on youtubetotranscript.com')}
      </a>
    </div>
  )
}

export default function YoutubeEmbeddedPlayer({
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
  const { videoId, isShort } = useMemo(() => parseYoutubeUrl(url), [url])
  const [initSuccess, setInitSuccess] = useState(false)
  const [error, setError] = useState(false)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!autoLoadMedia) setUserClickedLoad(false)
  }, [autoLoadMedia])

  const showEmbed = mustLoad || autoLoadMedia || userClickedLoad

  const posterUrl = useMemo(
    () => (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
    [videoId]
  )

  const frameClassName = useMemo(
    () =>
      cn(
        isShort ? 'aspect-[9/16] max-h-[80vh] sm:max-h-[60vh]' : 'aspect-video max-h-[60vh]',
        className
      ),
    [isShort, className]
  )

  useEffect(() => {
    if (!videoId || !containerRef.current || !showEmbed) return

    let cancelled = false

    void ensureYouTubeIframeApi().then(() => {
      if (cancelled || !containerRef.current) return
      try {
        if (!videoId || !window.YT?.Player) return
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId: videoId,
          playerVars: {
            mute: 1
          },
          events: {
            onStateChange: (event: any) => {
              if (event.data === window.YT.PlayerState.PLAYING) {
                mediaManager.play(playerRef.current)
              } else if (event.data === window.YT.PlayerState.PAUSED) {
                mediaManager.pause(playerRef.current)
              }
            },
            onReady: () => {
              setInitSuccess(true)
            },
            onError: () => setError(true)
          }
        })
      } catch (error) {
        logger.error('Failed to initialize YouTube player', { error })
        setError(true)
      }
    })

    return () => {
      cancelled = true
      const player = playerRef.current
      playerRef.current = null
      if (!player) return
      try {
        player.destroy()
      } catch {
        // React often removes the host node first when auto-load media is turned off; YT then hits removeChild errors.
      }
    }
  }, [videoId, showEmbed])

  if (error) {
    if (!videoId) return <ExternalLink url={url} />
    return (
      <YoutubePlayerShell videoId={videoId}>
        <ExternalLink url={url} />
      </YoutubePlayerShell>
    )
  }

  if (!mustLoad && !showEmbed) {
    if (!videoId) {
      return (
        <LazyMediaTapPlaceholder
          src={url}
          mediaKind="video"
          posterUrl={posterUrl}
          onActivate={() => setUserClickedLoad(true)}
          className={frameClassName}
        />
      )
    }
    return (
      <YoutubePlayerShell videoId={videoId}>
        <LazyMediaTapPlaceholder
          src={url}
          mediaKind="video"
          posterUrl={posterUrl}
          onActivate={() => setUserClickedLoad(true)}
          className={frameClassName}
        />
      </YoutubePlayerShell>
    )
  }

  if (!videoId && !initSuccess) {
    return <ExternalLink url={url} />
  }

  if (!videoId) {
    return (
      <div
        className={cn(
          'not-prose rounded-lg border overflow-hidden w-full max-w-[400px]',
          frameClassName
        )}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>
    )
  }

  return (
    <YoutubePlayerShell videoId={videoId}>
      <div
        className={cn(
          'not-prose rounded-lg border overflow-hidden w-full max-w-[400px]',
          frameClassName
        )}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </YoutubePlayerShell>
  )
}
