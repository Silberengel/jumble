import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import mediaManager from '@/services/media-manager.service'
import { Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ExternalLink from '../ExternalLink'
import { MediaErrorBoundary } from '../MediaErrorBoundary'
import logger from '@/lib/logger'

interface AudioPlayerProps {
  src: string
  className?: string
  /** Optional cover / still (e.g. NIP-53 `image` on live events). */
  poster?: string
  /** Fires when enough data is buffered to play (e.g. to swap out a blurhash placeholder). */
  onReady?: () => void
}

export default function AudioPlayer({ src, className, poster, onReady }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState(false)
  const seekTimeoutRef = useRef<NodeJS.Timeout>()
  const isSeeking = useRef(false)

  useEffect(() => {
    if (!onReady) return
    const audio = audioRef.current
    if (!audio) return
    const notify = () => onReady()
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      notify()
      return
    }
    audio.addEventListener('canplay', notify, { once: true })
    return () => audio.removeEventListener('canplay', notify)
  }, [src, onReady])

  useEffect(() => {
    if (error) {
      onReady?.()
    }
  }, [error, onReady])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => {
      if (!isSeeking.current) {
        const t = audio.currentTime
        if (Number.isFinite(t)) {
          setCurrentTime(t)
        }
      }
    }
    const updateDuration = () => {
      const d = audio.duration
      setDuration(Number.isFinite(d) && d > 0 ? d : 0)
    }
    const handleEnded = () => setIsPlaying(false)
    const handlePause = () => setIsPlaying(false)
    const handlePlay = () => setIsPlaying(true)

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('play', handlePlay)

    return () => {
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('play', handlePlay)
    }
  }, [])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
      mediaManager.play(audio)
    }
  }

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current
    if (!audio) return

    let t = value[0]
    if (!Number.isFinite(t) || t < 0) {
      return
    }
    const d = audio.duration
    if (Number.isFinite(d) && d > 0) {
      t = Math.min(t, d)
    }

    isSeeking.current = true
    setCurrentTime(t)

    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current)
    }

    seekTimeoutRef.current = setTimeout(() => {
      if (Number.isFinite(t) && t >= 0) {
        audio.currentTime = t
      }
      isSeeking.current = false
    }, 300)
  }

  if (error) {
    return <ExternalLink url={src} />
  }

  const cover = poster?.trim()

  return (
    <MediaErrorBoundary
      fallback={<ExternalLink url={src} />}
      onError={(error) => {
        // Don't log expected media errors
        if (error.name !== 'AbortError' && !error.message.includes('play() request was interrupted')) {
          logger.warn('Audio player error', error)
        }
        setError(true)
      }}
    >
      <div className={cn('flex w-full max-w-md flex-col gap-2', className)} onClick={(e) => e.stopPropagation()}>
        {cover ? (
          <div className="not-prose overflow-hidden rounded-lg border border-border bg-muted shadow-sm">
            <img
              src={cover}
              alt=""
              className="aspect-video w-full max-h-48 object-cover"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          </div>
        ) : null}
        <div
          className={cn(
            'flex w-full items-center gap-3 rounded-full border py-2 pl-2 pr-4',
            !cover && 'max-w-md'
          )}
        >
          <audio ref={audioRef} src={src} preload="metadata" onError={() => setError(true)} />

          <Button size="icon" className="shrink-0 rounded-full" onClick={togglePlay}>
            {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </Button>

          <div className="relative min-w-0 flex-1">
            <Slider
              value={[Number.isFinite(currentTime) ? currentTime : 0]}
              max={Number.isFinite(duration) && duration > 0 ? duration : 100}
              step={1}
              onValueChange={handleSeek}
              hideThumb
              enableHoverAnimation
            />
          </div>

          <div className="shrink-0 font-mono text-sm text-muted-foreground">
            {formatTime(Math.max(duration - currentTime, 0))}
          </div>
        </div>
      </div>
    </MediaErrorBoundary>
  )
}

const formatTime = (time: number) => {
  if (time === Infinity || isNaN(time)) {
    return '-:--'
  }
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
