import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useEffect, useState } from 'react'
import AudioPlayer from '../AudioPlayer'
import VideoPlayer from '../VideoPlayer'
import ExternalLink from '../ExternalLink'
import LazyMediaTapPlaceholder from './LazyMediaTapPlaceholder'

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

  useEffect(() => {
    if (autoLoadMedia) {
      setDisplay(true)
    } else {
      setDisplay(false)
    }
  }, [autoLoadMedia])

  useEffect(() => {
    if (!mustLoad && !display) {
      setMediaType(null)
      return
    }
    if (!src) {
      setMediaType(null)
      return
    }

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
      setMediaType(video.videoWidth > 0 || video.videoHeight > 0 ? 'video' : 'audio')
    }

    video.onerror = () => {
      setMediaType(null)
    }

    return () => {
      video.src = ''
    }
  }, [src, display, mustLoad])

  if (!mustLoad && !display) {
    return (
      <LazyMediaTapPlaceholder
        src={src}
        posterUrl={poster}
        blurHash={blurHash}
        onActivate={() => setDisplay(true)}
        className={className}
      />
    )
  }

  if (!mediaType) {
    return <ExternalLink url={src} />
  }

  if (mediaType === 'video') {
    return <VideoPlayer src={src} className={className} poster={poster} />
  }

  return <AudioPlayer src={src} className={className} />
}
