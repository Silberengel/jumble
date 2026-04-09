import { isImage } from '@/lib/url'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AudioPlayer from '../AudioPlayer'
import VideoPlayer from '../VideoPlayer'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder, { MediaEmbedBlurFrame } from './LazyMediaTapPlaceholder'

/** Same rules as the metadata probe, but synchronous so the first paint can show the embed stack. */
function embedMediaTypeHintFromUrl(src: string): 'video' | 'audio' | null {
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
      ['mp4', 'webm', 'm4v', 'mov', 'avi', '3gp', '3g2'].includes(extension)
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
  poster,
  blurHash
}: {
  src: string
  className?: string
  mustLoad?: boolean
  poster?: string
  /** NIP-94 / imeta blurhash for lazy placeholder when poster is missing */
  blurHash?: string
}) {
  const { autoLoadMedia } = useContentPolicy()
  const [display, setDisplay] = useState(autoLoadMedia)
  const [mediaType, setMediaType] = useState<'video' | 'audio' | null>(null)
  const [probeFailed, setProbeFailed] = useState(false)
  const [embedPainted, setEmbedPainted] = useState(false)
  const readyOnceRef = useRef(false)

  // imeta `thumb` / `image` are sometimes the same .mp4 as `url` — <img> cannot use that, and it
  // would hide the blurhash placeholder in LazyMediaTapPlaceholder.
  const imagePoster = useMemo(() => {
    const p = poster?.trim()
    if (!p) return undefined
    return isImage(p) ? p : undefined
  }, [poster])

  const urlEmbedTypeHint = useMemo(() => embedMediaTypeHintFromUrl(src), [src])
  /** Probe result wins when set (e.g. audio-only mp4); URL hint avoids a blank frame before useEffect runs. */
  const effectiveMediaType = mediaType ?? urlEmbedTypeHint

  const showEmbed = mustLoad || display

  useEffect(() => {
    if (autoLoadMedia) {
      setDisplay(true)
    } else {
      setDisplay(false)
    }
  }, [autoLoadMedia])

  useEffect(() => {
    readyOnceRef.current = false
    setEmbedPainted(false)
    setMediaType(null)
    setProbeFailed(false)
  }, [src])

  useEffect(() => {
    if (!showEmbed) {
      setMediaType(null)
      setProbeFailed(false)
      return
    }
    readyOnceRef.current = false
    setEmbedPainted(false)
    if (!src) {
      setProbeFailed(true)
      return
    }

    setProbeFailed(false)
    setMediaType(null)

    let cancelled = false

    try {
      const url = new URL(src)
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
      video.src = src
      video.preload = 'metadata'

      video.onloadedmetadata = () => {
        if (cancelled) return
        setMediaType(video.videoWidth > 0 || video.videoHeight > 0 ? 'video' : 'audio')
      }

      video.onerror = () => {
        if (cancelled) return
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
  }, [src, showEmbed])

  const onEmbedReady = useCallback(() => {
    if (readyOnceRef.current) return
    readyOnceRef.current = true
    setEmbedPainted(true)
  }, [])

  if (!mustLoad && !display) {
    return (
      <LazyMediaTapPlaceholder
        src={src}
        posterUrl={imagePoster}
        blurHash={blurHash}
        onActivate={() => setDisplay(true)}
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
        src={src}
        posterUrl={imagePoster}
        blurHash={blurHash}
        className={className}
      />
    )
  }

  const layerTransition =
    'transition-opacity duration-300 ease-out motion-reduce:transition-none'

  return (
    <div className="relative w-full max-w-[400px]">
      <div
        className={cn(
          layerTransition,
          embedPainted
            ? 'pointer-events-none absolute inset-0 z-10 opacity-0'
            : 'relative z-10 w-full opacity-100'
        )}
        aria-hidden={embedPainted}
      >
        <MediaEmbedBlurFrame
          src={src}
          posterUrl={imagePoster}
          blurHash={blurHash}
          className={className}
        />
      </div>
      <div
        className={cn(
          layerTransition,
          embedPainted
            ? 'relative z-20 w-full overflow-hidden opacity-100'
            : 'absolute inset-0 z-0 w-full overflow-hidden opacity-0 pointer-events-none'
        )}
        aria-hidden={!embedPainted}
      >
        {effectiveMediaType === 'video' ? (
          <VideoPlayer src={src} className={className} poster={imagePoster} onReady={onEmbedReady} />
        ) : (
          <AudioPlayer src={src} className={className} onReady={onEmbedReady} />
        )}
      </div>
    </div>
  )
}
