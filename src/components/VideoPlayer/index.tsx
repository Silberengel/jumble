import { isImwaldElectron } from '@/lib/client-platform'
import { isHlsPlaylistUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
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
  onReady,
  fallbackPageUrl
}: {
  src: string
  className?: string
  poster?: string
  /** Fires when the first frame is available (e.g. to swap out a blurhash placeholder). */
  onReady?: () => void
  /** When inline playback fails (e.g. empty HLS manifest), link here instead of showing a raw manifest URL. */
  fallbackPageUrl?: string
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

    /**
     * Mobile: `threshold: 1` + a second `isInViewport` (full element inside innerHeight) caused
     * play/pause thrash as the toolbar/resizes and subpixel layout toggled visibility. That produced
     * a buffering spinner loop (Loader2) and stutter. Use fractional visibility + debounced pause.
     */
    const PLAY_AFTER_VISIBLE_RATIO = 0.35
    const PAUSE_BELOW_RATIO = 0.12
    const PLAY_DELAY_MS = 200
    const PAUSE_DELAY_MS = 450

    let playTimer: ReturnType<typeof setTimeout> | undefined
    let pauseTimer: ReturnType<typeof setTimeout> | undefined

    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry.intersectionRatio
        if (ratio >= PLAY_AFTER_VISIBLE_RATIO) {
          if (pauseTimer !== undefined) {
            clearTimeout(pauseTimer)
            pauseTimer = undefined
          }
          if (playTimer !== undefined) return
          playTimer = setTimeout(() => {
            playTimer = undefined
            mediaManager.autoPlay(video)
          }, PLAY_DELAY_MS)
        } else if (ratio <= PAUSE_BELOW_RATIO) {
          if (playTimer !== undefined) {
            clearTimeout(playTimer)
            playTimer = undefined
          }
          if (pauseTimer !== undefined) return
          pauseTimer = setTimeout(() => {
            pauseTimer = undefined
            mediaManager.pause(video)
          }, PAUSE_DELAY_MS)
        }
      },
      { threshold: [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1] }
    )

    observer.observe(container)

    return () => {
      if (playTimer !== undefined) clearTimeout(playTimer)
      if (pauseTimer !== undefined) clearTimeout(pauseTimer)
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
    if (fallbackPageUrl?.trim()) {
      return (
        <div
          className="not-prose w-full space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {poster ? (
            <img
              src={poster}
              alt=""
              className="aspect-video w-full max-h-[40vh] rounded-md object-cover"
            />
          ) : null}
          <p className="text-sm leading-snug text-muted-foreground">{t('liveEvent.hlsPlaybackUnavailable')}</p>
          <a
            href={fallbackPageUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-sm font-medium text-green-600 underline-offset-2 hover:underline dark:text-green-400 dark:hover:text-green-300"
            onClick={(e) => e.stopPropagation()}
          >
            {t('Open in browser')}
          </a>
        </div>
      )
    }
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
