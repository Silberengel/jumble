import {
  isHlsPlaylistUrl,
  isImage,
  isRenderableMediaUrl,
  isZapStreamWatchPageUrl,
  primalR2aMirrorForBlossomPrimalUrl,
  resolvePrimalBlossomPlayableUrl
} from '@/lib/url'
import { cn } from '@/lib/utils'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AudioPlayer from '../AudioPlayer'
import VideoPlayer from '../VideoPlayer'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder, { MediaEmbedBlurFrame } from './LazyMediaTapPlaceholder'

type MediaSurface = 'video' | 'audio' | 'iframe' | null

/** Same rules as the metadata probe, but synchronous so the first paint can show the embed stack. */
function embedMediaSurfaceHintFromUrl(src: string): MediaSurface {
  if (isZapStreamWatchPageUrl(src)) return 'iframe'
  try {
    const url = new URL(src)
    const extension = url.pathname.split('.').pop()?.toLowerCase()
    if (
      extension &&
      ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'wma', 'mka', 'oga'].includes(extension)
    ) {
      return 'audio'
    }
    if (extension === 'mkv' || extension === 'ogv') {
      return 'video'
    }
    if (
      extension &&
      ['mp4', 'webm', 'm4v', 'mov', 'avi', '3gp', '3g2', 'm3u8', 'm3u'].includes(extension)
    ) {
      return 'video'
    }
    return null
  } catch {
    return null
  }
}

export default function MediaPlayer({
  src,
  className,
  mustLoad = false,
  deferLoadUntilClick = false,
  authorPubkey,
  poster,
  blurHash,
  fallbackPageUrl,
  dim
}: {
  src: string
  className?: string
  mustLoad?: boolean
  /**
   * When true, never autoload/embed (even if global auto-load media is on) until the user taps the
   * placeholder. Used for NIP-71 long-form video events in feeds.
   */
  deferLoadUntilClick?: boolean
  /** Note author; when set, follow-only and related policies apply per author. */
  authorPubkey?: string | null
  poster?: string
  /** NIP-94 / imeta blurhash for lazy placeholder when poster is missing */
  blurHash?: string
  /** Passed to {@link VideoPlayer} when HLS/video playback fails (e.g. NIP-53 zap.stream join URL). */
  fallbackPageUrl?: string
  /** NIP-94 `dim` — reserve correct aspect ratio before the player loads. */
  dim?: { width: number; height: number }
}) {
  const { t } = useTranslation()
  const authorAutoLoad = useShouldAutoLoadMedia(authorPubkey)
  /** Tap-to-load when auto-load is off for this author; cleared when policy switches back to never. */
  const [userClickedLoad, setUserClickedLoad] = useState(false)
  const [mediaType, setMediaType] = useState<MediaSurface>(null)
  const [probeFailed, setProbeFailed] = useState(false)
  const [embedPainted, setEmbedPainted] = useState(false)
  /** After r2a mirror fails, retry metadata probe with canonical blossom.primal.net URL once. */
  const [preferCanonicalBlossomUrl, setPreferCanonicalBlossomUrl] = useState(false)
  const readyOnceRef = useRef(false)

  const playableSrc = useMemo(() => {
    const raw = src.trim()
    if (!isRenderableMediaUrl(raw)) return ''
    if (preferCanonicalBlossomUrl) return raw
    return resolvePrimalBlossomPlayableUrl(src)
  }, [src, preferCanonicalBlossomUrl])

  // imeta `thumb` / `image` are sometimes the same .mp4 as `url` — <img> cannot use that, and it
  // would hide the blurhash placeholder in LazyMediaTapPlaceholder.
  const imagePoster = useMemo(() => {
    const p = poster?.trim()
    if (!p) return undefined
    return isImage(p) ? resolvePrimalBlossomPlayableUrl(p) : undefined
  }, [poster])

  const urlEmbedSurfaceHint = useMemo(() => embedMediaSurfaceHintFromUrl(playableSrc), [playableSrc])
  /** Probe result wins when set (e.g. audio-only mp4); URL hint avoids a blank frame before useEffect runs. */
  const effectiveMediaType = mediaType ?? urlEmbedSurfaceHint

  const showEmbed =
    mustLoad || (!deferLoadUntilClick && authorAutoLoad) || userClickedLoad

  useLayoutEffect(() => {
    if (!authorAutoLoad) setUserClickedLoad(false)
  }, [authorAutoLoad])

  useEffect(() => {
    readyOnceRef.current = false
    setEmbedPainted(false)
    setMediaType(null)
    setProbeFailed(false)
    setPreferCanonicalBlossomUrl(false)
  }, [src])

  useEffect(() => {
    if (!showEmbed) {
      setMediaType(null)
      setProbeFailed(false)
      return
    }
    readyOnceRef.current = false
    setEmbedPainted(false)
    if (!playableSrc) {
      setProbeFailed(true)
      return
    }

    setProbeFailed(false)
    setMediaType(null)

    let cancelled = false

    try {
      // Firefox/Chrome do not expose HLS via <video> metadata probe — it fails and looked like “no player”.
      if (isHlsPlaylistUrl(playableSrc)) {
        setMediaType('video')
        return
      }

      if (isZapStreamWatchPageUrl(playableSrc)) {
        setMediaType('iframe')
        return
      }

      const url = new URL(playableSrc)
      const extension = url.pathname.split('.').pop()?.toLowerCase()

      if (
        extension &&
        ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'wma', 'mka'].includes(extension)
      ) {
        setMediaType('audio')
        return
      }

      if (extension === 'mkv' || extension === 'ogv') {
        setMediaType('video')
        return
      }

      const video = document.createElement('video')
      video.src = playableSrc
      video.preload = 'metadata'

      video.onloadedmetadata = () => {
        if (cancelled) return
        setMediaType(video.videoWidth > 0 || video.videoHeight > 0 ? 'video' : 'audio')
      }

      video.onerror = () => {
        if (cancelled) return
        const raw = src.trim()
        const mirror = raw ? primalR2aMirrorForBlossomPrimalUrl(raw) : null
        if (mirror && playableSrc === mirror && raw !== mirror && !preferCanonicalBlossomUrl) {
          setPreferCanonicalBlossomUrl(true)
          return
        }
        setProbeFailed(true)
        setMediaType(null)
      }

      return () => {
        cancelled = true
        video.src = ''
      }
    } catch {
      setProbeFailed(true)
    }
  }, [playableSrc, showEmbed, src, preferCanonicalBlossomUrl])

  const onEmbedReady = useCallback(() => {
    if (readyOnceRef.current) return
    readyOnceRef.current = true
    setEmbedPainted(true)
  }, [])

  const blurLoadingHint = useMemo(() => {
    if (!showEmbed) return undefined
    if (effectiveMediaType === null) {
      return t('Preparing player…', { defaultValue: 'Preparing player…' })
    }
    if (!embedPainted) {
      if (isZapStreamWatchPageUrl(playableSrc)) {
        return t('Starting stream…', { defaultValue: 'Starting stream…' })
      }
      if (isHlsPlaylistUrl(playableSrc)) {
        return t('Starting stream…', { defaultValue: 'Starting stream…' })
      }
      return t('Loading media…', { defaultValue: 'Loading media…' })
    }
    return undefined
  }, [showEmbed, effectiveMediaType, embedPainted, playableSrc, t])

  if (!isRenderableMediaUrl(src.trim())) {
    return null
  }

  if (!mustLoad && !showEmbed) {
    return (
      <LazyMediaTapPlaceholder
        src={playableSrc}
        posterUrl={imagePoster}
        blurHash={blurHash}
        dim={dim}
        onActivate={() => setUserClickedLoad(true)}
        className={className}
      />
    )
  }

  if (probeFailed) {
    return <ExternalLink url={src} />
  }

  if (effectiveMediaType === null) {
    return (
      <MediaEmbedBlurFrame
        src={playableSrc}
        posterUrl={imagePoster}
        blurHash={blurHash}
        dim={dim}
        className={className}
        loadingHint={blurLoadingHint}
      />
    )
  }

  const layerTransition =
    'transition-opacity duration-300 ease-out motion-reduce:transition-none'

  return (
    <div className="not-prose relative w-full max-w-[400px] shrink-0 self-start">
      {!embedPainted ? (
        <div className="relative z-10 w-full">
          <MediaEmbedBlurFrame
            src={playableSrc}
            posterUrl={imagePoster}
            blurHash={blurHash}
            dim={dim}
            className={className}
            loadingHint={blurLoadingHint}
          />
        </div>
      ) : null}
      <div
        className={cn(
          layerTransition,
          embedPainted
            ? 'relative z-20 w-full overflow-hidden opacity-100'
            : 'absolute inset-0 z-0 w-full overflow-hidden opacity-0 pointer-events-none'
        )}
        aria-hidden={!embedPainted}
      >
        {effectiveMediaType === 'iframe' ? (
          <iframe
            src={src}
            title={t('liveEvent.zapStreamPlayer')}
            className={cn('aspect-video h-[min(520px,70dvh)] w-full rounded-md border border-border bg-black', className)}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            allow="autoplay; encrypted-media; microphone; clipboard-write"
            onLoad={onEmbedReady}
          />
        ) : effectiveMediaType === 'video' ? (
          <VideoPlayer
            src={playableSrc}
            className={className}
            poster={imagePoster}
            onReady={onEmbedReady}
            fallbackPageUrl={fallbackPageUrl}
          />
        ) : (
          <AudioPlayer
            src={playableSrc}
            className={className}
            poster={imagePoster}
            onReady={onEmbedReady}
          />
        )}
      </div>
    </div>
  )
}
