import { cn } from '@/lib/utils'
import { resolveMediaBlurPlaceholder } from '@/lib/media-placeholder-blurhash'
import { decode } from 'blurhash'
import { Music2, Play } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const CANVAS_W = 32
const CANVAS_H = 32

function guessMediaKindFromUrl(src: string): 'video' | 'audio' {
  try {
    const pathname = new URL(src).pathname.toLowerCase()
    const ext = pathname.split('.').pop() || ''
    if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'wma', 'mka', 'oga'].includes(ext)) {
      return 'audio'
    }
    return 'video'
  } catch {
    return 'video'
  }
}

function BlurHashLayer({ blurHash, className }: { blurHash: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixels = useMemo(() => {
    try {
      return decode(blurHash, CANVAS_W, CANVAS_H)
    } catch {
      return null
    }
  }, [blurHash])

  useEffect(() => {
    if (!pixels || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
  }, [pixels])

  if (!pixels) {
    return <div className={cn('absolute inset-0 bg-muted', className)} />
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className={cn('absolute inset-0 h-full w-full object-cover', className)}
      style={{ imageRendering: 'auto', filter: 'blur(0.5px)' }}
    />
  )
}

export default function LazyMediaTapPlaceholder({
  src,
  posterUrl,
  blurHash,
  onActivate,
  className
}: {
  src: string
  posterUrl?: string
  blurHash?: string
  onActivate: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const kind = guessMediaKindFromUrl(src)
  const hash = resolveMediaBlurPlaceholder(src, blurHash)
  const poster = posterUrl?.trim()
  const label = t('Click to load media')

  return (
    <button
      type="button"
      className={cn(
        'group relative w-full max-w-[400px] overflow-hidden rounded-lg border border-border bg-muted/30 text-left shadow-sm outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring',
        kind === 'video' ? 'aspect-video' : 'min-h-[7.5rem] aspect-[21/9]',
        className
      )}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onActivate()
      }}
      aria-label={label}
      title={label}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <BlurHashLayer blurHash={hash} />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/25 to-black/15" aria-hidden />
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
        <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-[2px] transition-transform group-hover:scale-105 group-focus-visible:scale-105">
          {kind === 'video' ? (
            <Play className="size-8 fill-current pl-1" strokeWidth={0} />
          ) : (
            <Music2 className="size-8" strokeWidth={2} />
          )}
        </span>
      </span>
    </button>
  )
}
