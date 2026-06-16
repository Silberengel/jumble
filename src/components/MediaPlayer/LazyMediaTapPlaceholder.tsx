import { aspectRatioStyleFromDim, type ImetaDim } from '@/lib/imeta-display'
import { isRenderableMediaUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import { resolveMediaBlurPlaceholder } from '@/lib/media-placeholder-blurhash'
import { decode } from 'blurhash'
import { Loader2, Music2, Play } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
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

  // Layout effect so the canvas is painted before the browser's next paint (no empty flash).
  useLayoutEffect(() => {
    if (!pixels || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
  }, [pixels])

  if (!pixels) {
    return <div className={cn('absolute inset-0 z-0 bg-muted', className)} />
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className={cn('absolute inset-0 z-0 h-full w-full object-cover', className)}
      style={{ imageRendering: 'auto', filter: 'blur(0.5px)' }}
    />
  )
}

const frameClass = (
  kind: 'video' | 'audio',
  className?: string,
  dim?: ImetaDim
) =>
  cn(
    // `not-prose`: poster <img> lives inside MarkdownArticle `.prose`; typography adds img margins
    // that break `absolute inset-0` layout and show a blurhash band above the still.
    'not-prose relative w-full max-w-[400px] shrink-0 self-start overflow-hidden rounded-lg border border-border bg-muted/30 shadow-sm',
    !aspectRatioStyleFromDim(dim) &&
      (kind === 'video' ? 'aspect-video' : 'min-h-[7.5rem] aspect-[21/9]'),
    className
  )

function mediaFrameStyle(dim?: ImetaDim): CSSProperties | undefined {
  return aspectRatioStyleFromDim(dim)
}

function MediaPlaceholderLayers({
  src,
  posterUrl,
  blurHash,
  showTapChrome,
  mediaKind
}: {
  src: string
  posterUrl?: string
  blurHash?: string
  showTapChrome: boolean
  /** When set, overrides extension-based guess (e.g. Spotify / YouTube URLs). */
  mediaKind?: 'video' | 'audio'
}) {
  const kind = mediaKind ?? guessMediaKindFromUrl(src)
  const hash = resolveMediaBlurPlaceholder(src, blurHash)
  const posterRaw = posterUrl?.trim()
  const poster = posterRaw && isRenderableMediaUrl(posterRaw) ? posterRaw : undefined

  return (
    <>
      {/* Blur under poster so color shows instantly while the image loads */}
      <BlurHashLayer blurHash={hash} />
      {poster ? (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 z-[1] m-0 h-full w-full max-w-none object-cover object-center"
          loading="eager"
          decoding="async"
        />
      ) : null}
      <span className="absolute inset-0 z-[2] bg-gradient-to-t from-black/55 via-black/25 to-black/15" aria-hidden />
      {showTapChrome ? (
        <span
          className="absolute inset-0 z-[3] grid place-items-center"
          aria-hidden
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-[2px] transition-transform group-hover:scale-105 group-focus-visible:scale-105">
            {kind === 'video' ? (
              <Play className="size-8 fill-current pl-1" strokeWidth={0} />
            ) : (
              <Music2 className="size-8" strokeWidth={2} />
            )}
          </span>
        </span>
      ) : null}
    </>
  )
}

/** Blurhash (or poster) frame while video/audio embed loads — no tap target. */
export function MediaEmbedBlurFrame({
  src,
  posterUrl,
  blurHash,
  className,
  mediaKind,
  loadingHint,
  dim
}: {
  src: string
  posterUrl?: string
  blurHash?: string
  className?: string
  mediaKind?: 'video' | 'audio'
  /** Shown over the frame (e.g. live HLS) so long stalls are not a silent blank. */
  loadingHint?: string
  dim?: ImetaDim
}) {
  const kind = mediaKind ?? guessMediaKindFromUrl(src)
  return (
    <div
      className={cn(frameClass(kind, className, dim), 'pointer-events-none select-none')}
      style={mediaFrameStyle(dim)}
      aria-hidden={loadingHint ? undefined : true}
      aria-busy={loadingHint ? true : undefined}
    >
      <div className="absolute inset-0 overflow-hidden rounded-lg">
        <MediaPlaceholderLayers
          src={src}
          posterUrl={posterUrl}
          blurHash={blurHash}
          showTapChrome={false}
          mediaKind={mediaKind}
        />
        {loadingHint ? (
          <div
            className="absolute inset-x-0 bottom-0 z-[4] flex justify-center p-3 pt-8 bg-gradient-to-t from-black/70 to-transparent"
            role="status"
            aria-live="polite"
          >
            <span className="inline-flex max-w-[min(100%,18rem)] items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur-sm">
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              <span className="truncate">{loadingHint}</span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function LazyMediaTapPlaceholder({
  src,
  posterUrl,
  blurHash,
  onActivate,
  className,
  mediaKind,
  dim
}: {
  src: string
  posterUrl?: string
  blurHash?: string
  onActivate: () => void
  className?: string
  mediaKind?: 'video' | 'audio'
  dim?: ImetaDim
}) {
  const { t } = useTranslation()
  const kind = mediaKind ?? guessMediaKindFromUrl(src)
  const label = t('Click to load media')
  const dimStyle = mediaFrameStyle(dim)

  return (
    <button
      type="button"
      className={cn(
        // `block` + `p-0` + `leading-none`: native <button> keeps a line-box / padding; with only
        // absolutely positioned children that shifts the stack and the play icon looks bottom-heavy.
        // `not-prose`: see frameClass — poster img must not inherit prose img margins inside notes.
        'not-prose group relative block w-full max-w-[400px] shrink-0 self-start overflow-hidden rounded-lg border border-border bg-muted/30 p-0 text-left leading-none shadow-sm outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring',
        !dimStyle && (kind === 'video' ? 'aspect-video' : 'min-h-[7.5rem] aspect-[21/9]'),
        className
      )}
      style={dimStyle}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onActivate()
      }}
      aria-label={label}
      title={label}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
        <MediaPlaceholderLayers
          src={src}
          posterUrl={posterUrl}
          blurHash={blurHash}
          showTapChrome
          mediaKind={mediaKind}
        />
      </span>
    </button>
  )
}
