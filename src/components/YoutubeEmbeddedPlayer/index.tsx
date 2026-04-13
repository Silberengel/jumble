import { isImwaldElectron } from '@/lib/client-platform'
import { ensureYouTubeIframeApi } from '@/lib/youtube-iframe-api'
import { parseYoutubeUrl } from '@/lib/youtube-url'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import mediaManager from '@/services/media-manager.service'
import { YouTubePlayer } from '@/types/youtube'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from '../MediaPlayer/LazyMediaTapPlaceholder'
import logger from '@/lib/logger'

export default function YoutubeEmbeddedPlayer({
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
  const { videoId, isShort } = useMemo(() => parseYoutubeUrl(url), [url])
  const [initSuccess, setInitSuccess] = useState(false)
  const [error, setError] = useState(false)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!autoLoadMedia) setUserClickedLoad(false)
  }, [autoLoadMedia])

  const showEmbed = mustLoad || autoLoadMedia || userClickedLoad
  /**
   * Electron + dev server (http/https): use the same YT Iframe API as the browser — plain `/embed/` iframes often
   * show error 150 (player configuration) in Electron while the API path works.
   * Packaged app loads `file:`; keep a plain iframe there and pass a stable `origin` so YouTube accepts the embed.
   */
  const useNativeEmbed =
    isImwaldElectron() &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'file:'

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
    if (useNativeEmbed) return
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
  }, [videoId, showEmbed, useNativeEmbed])

  if (error && !useNativeEmbed) {
    return <ExternalLink url={url} />
  }

  if (!mustLoad && !showEmbed) {
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

  if (!videoId && !initSuccess) {
    return <ExternalLink url={url} />
  }

  if (useNativeEmbed && videoId) {
    // `file:` has no usable origin for YT; use the canonical web app origin (matches typical production URL).
    const embedParams = new URLSearchParams({
      playsinline: '1',
      rel: '0',
      enablejsapi: '1',
      origin: 'https://jumble.imwald.eu'
    })
    const embedSrc = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${embedParams}`
    return (
      <div
        className={cn(
          'not-prose rounded-lg border overflow-hidden w-full max-w-[400px]',
          frameClassName
        )}
      >
        <iframe
          className="h-full w-full min-h-[12rem] border-0"
          src={embedSrc}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    )
  }

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
