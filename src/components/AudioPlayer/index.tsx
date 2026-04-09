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
  /** Fires when enough data is buffered to play (e.g. to swap out a blurhash placeholder). */
  onReady?: () => void
}

export default function AudioPlayer({ src, className, onReady }: AudioPlayerProps) {
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
        setCurrentTime(audio.currentTime)
      }
    }
    const updateDuration = () => setDuration(audio.duration)
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

    isSeeking.current = true
    setCurrentTime(value[0])

    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current)
    }

    seekTimeoutRef.current = setTimeout(() => {
      audio.currentTime = value[0]
      isSeeking.current = false
    }, 300)
  }

  if (error) {
    return <ExternalLink url={src} />
  }

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
      <div
        className={cn(
          'flex items-center gap-3 py-2 pl-2 pr-4 border rounded-full max-w-md',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <audio ref={audioRef} src={src} preload="metadata" onError={() => setError(true)} />

        {/* Play/Pause Button */}
        <Button size="icon" className="rounded-full shrink-0" onClick={togglePlay}>
          {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </Button>

        {/* Progress Section */}
        <div className="flex-1 relative">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={1}
            onValueChange={handleSeek}
            hideThumb
            enableHoverAnimation
          />
        </div>

        <div className="text-sm font-mono text-muted-foreground">
          {formatTime(Math.max(duration - currentTime, 0))}
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
