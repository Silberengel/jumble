import { isImwaldElectron } from '@/lib/client-platform'
import { isHlsPlaylistUrl } from '@/lib/url'
import { cn, isInViewport } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import mediaManager from '@/services/media-manager.service'
import Hls from 'hls.js'
import { Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ExternalLink from '../ExternalLink'
import { MediaErrorBoundary } from '../MediaErrorBoundary'
import logger from '@/lib/logger'

/** Safari plays HLS natively; Chromium/Firefox need MSE via hls.js. */
function hlsPlaybackMode(src: string): 'hlsjs' | 'native' {
  if (typeof document === 'undefined') return 'native'
  if (!isHlsPlaylistUrl(src)) return 'native'
  const probe = document.createElement('video')
  if (probe.canPlayType('application/vnd.apple.mpegurl')) return 'native'
  return Hls.isSupported() ? 'hlsjs' : 'native'
}

export default function VideoPlayer({
  src,
  className,
  poster,
  onReady
}: {
  src: string
  className?: string
  poster?: string
  /** Fires when the first frame is available (e.g. to swap out a blurhash placeholder). */
  onReady?: () => void
}) {
  const { t } = useTranslation()
  const { autoplay } = useContentPolicy()
  const [error, setError] = useState(false)
  const [showBufferOverlay, setShowBufferOverlay] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const hlsMode = useMemo(() => hlsPlaybackMode(src), [src])

  useEffect(() => {
    setError(false)
    setShowBufferOverlay(false)
  }, [src])

  useEffect(() => {
    const video = videoRef.current
    if (!video || error) return
    const onWaiting = () => setShowBufferOverlay(true)
    const clearBuffering = () => setShowBufferOverlay(false)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', clearBuffering)
    video.addEventListener('canplay', clearBuffering)
    video.addEventListener('seeked', clearBuffering)
    return () => {
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', clearBuffering)
      video.removeEventListener('canplay', clearBuffering)
      video.removeEventListener('seeked', clearBuffering)
    }
  }, [src, hlsMode, error])

  useEffect(() => {
    if (hlsMode !== 'hlsjs') return
    const video = videoRef.current
    if (!video) return

    const hls = new Hls({
      // `file:` packaged Electron cannot load bundled worker URLs reliably; main-thread demux is fine here.
      enableWorker: !isImwaldElectron(),
      lowLatencyMode: true
    })
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        logger.warn('HLS playback error', { type: data.type, details: data.details })
        setError(true)
      }
    })

    return () => {
      hls.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [src, hlsMode])

  useEffect(() => {
    if (!autoplay) return

    const video = videoRef.current
    const container = containerRef.current

    if (!video || !container) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            if (isInViewport(container)) {
              mediaManager.autoPlay(video)
            }
          }, 200)
        } else {
          mediaManager.pause(video)
        }
      },
      { threshold: 1 }
    )

    observer.observe(container)

    return () => {
      observer.unobserve(container)
    }
  }, [autoplay, src, hlsMode])

  useEffect(() => {
    if (error) {
      onReady?.()
    }
  }, [error, onReady])

  // `canplay` usually fires before `loadeddata` — swap the placeholder sooner for HLS and progressive video.
  useLayoutEffect(() => {
    if (!onReady) return
    const video = videoRef.current
    if (!video) return
    let done = false
    const notify = () => {
      if (done) return
      done = true
      onReady()
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      notify()
      return
    }
    video.addEventListener('canplay', notify, { once: true })
    video.addEventListener('loadeddata', notify, { once: true })
    return () => {
      video.removeEventListener('canplay', notify)
      video.removeEventListener('loadeddata', notify)
    }
  }, [src, onReady, hlsMode])

  if (error) {
    return <ExternalLink url={src} />
  }

  return (
    <MediaErrorBoundary
      fallback={<ExternalLink url={src} />}
      onError={(err) => {
        if (err.name !== 'AbortError' && !err.message.includes('play() request was interrupted')) {
          logger.warn('Video player error', err)
        }
        setError(true)
      }}
    >
      <div ref={containerRef} className="not-prose relative w-full max-w-full overflow-hidden">
        <video
          ref={videoRef}
          controls
          playsInline
          preload={onReady ? (hlsMode === 'hlsjs' ? 'auto' : 'metadata') : 'none'}
          className={cn(
            'm-0 max-w-full rounded-lg max-h-[80vh] sm:max-h-[60vh] border w-full h-auto',
            className
          )}
          src={hlsMode === 'hlsjs' ? undefined : src}
          poster={poster}
          onClick={(e) => e.stopPropagation()}
          onPlay={(event) => {
            mediaManager.play(event.currentTarget)
          }}
          muted
          onError={() => setError(true)}
        />
        {showBufferOverlay ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/35 backdrop-blur-[1px]"
            role="status"
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-sm font-medium text-white shadow-md">
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              {t('Buffering…', { defaultValue: 'Buffering…' })}
            </span>
          </div>
        ) : null}
      </div>
    </MediaErrorBoundary>
  )
}
