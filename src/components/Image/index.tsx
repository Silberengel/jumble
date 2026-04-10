import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { isRenderableMediaUrl, isSafeMediaUrl } from '@/lib/url'
import { TImetaInfo } from '@/types'
import { blurHashPlaceholderForMediaUrl } from '@/lib/media-placeholder-blurhash'
import { decode } from 'blurhash'
import { ImageOff } from 'lucide-react'
import {
  CSSProperties,
  HTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useTranslation } from 'react-i18next'

/** Browsers often never fire `onError` for invalid URIs, ORB, or stalled fetches — this forces a visible error. */
const IMAGE_LOAD_TIMEOUT_MS = 10_000

/** Without reserved height, `absolute` skeleton + `opacity-0` img collapse to 0×0 — looks like “nothing”. */
function wrapperReserveStyle(
  dim: { width: number; height: number } | undefined,
  showError: boolean
): CSSProperties | undefined {
  if (showError) return undefined
  if (dim && dim.width > 0 && dim.height > 0) {
    return { aspectRatio: `${dim.width} / ${dim.height}` }
  }
  return { minHeight: 'min(30vh, 280px)' }
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} KB`
  return `${bytes} B`
}

export default function Image({
  image: { url, blurHash, dim, alt: imetaAlt, fallback, size: fileSizeBytes },
  alt,
  className = '',
  classNames = {},
  hideIfError = false,
  errorPlaceholder = <ImageOff />,
  style: wrapperStyleProp,
  holdUntilClick = false,
  fetchPriority,
  onClick,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  classNames?: {
    wrapper?: string
    errorPlaceholder?: string
  }
  image: TImetaInfo
  alt?: string
  hideIfError?: boolean
  errorPlaceholder?: React.ReactNode
  /** Passed to the inner `<img>` (e.g. profile banner vs avatar load order). */
  fetchPriority?: 'high' | 'low' | 'auto'
  /**
   * When true, the full image is not loaded until the user interacts.
   * The first click runs {@link onClick} (e.g. open lightbox) and also reveals the
   * inline `<img>` so after the lightbox closes the real image can show from cache.
   *
   * Under {@link ContentPolicyProvider}, the user’s media auto-load setting overrides a stale
   * `holdUntilClick` from parents (e.g. MarkdownArticle’s default `lazyMedia`).
   */
  holdUntilClick?: boolean
}) {
  const { t } = useTranslation()
  const contentPolicy = useContentPolicyOptional()
  /** Tap-to-load only if the parent asked and policy allows (or there is no policy — trust the parent). */
  const effectiveHoldUntilClick =
    holdUntilClick && (contentPolicy !== undefined ? !contentPolicy.autoLoadMedia : true)

  const urlOk = !!url?.trim()
  const [revealed, setRevealed] = useState(!effectiveHoldUntilClick)
  const [isLoading, setIsLoading] = useState(urlOk && !effectiveHoldUntilClick)
  const [displaySkeleton, setDisplaySkeleton] = useState(urlOk)
  const [hasError, setHasError] = useState(!urlOk)
  const [imageUrl, setImageUrl] = useState(url)
  const [fallbackIndex, setFallbackIndex] = useState(0)
  const loadWatchRef = useRef<number | null>(null)
  // Kept in sync in the reset effect; load-timeout runs only while tap-to-load is actually active.
  const wasInitiallyHeldRef = useRef(effectiveHoldUntilClick)
  const imgRef = useRef<HTMLImageElement | null>(null)
  /** Deduplicate onLoad vs sync cache hit vs decode() — otherwise blurhash can stick when `onLoad` never runs. */
  const loadSettledRef = useRef(false)

  const finalAlt = imetaAlt || alt
  const openLinkHref =
    (isSafeMediaUrl(url) && url.trim()) || (isSafeMediaUrl(imageUrl) && imageUrl.trim()) || ''

  const badSrc = !imageUrl?.trim() || !isRenderableMediaUrl(imageUrl.trim())
  const showErrorState = hasError || badSrc

  /** NIP-94 blurhash when present; otherwise a stable URL-derived placeholder (many events omit blurhash). */
  const effectiveBlurHash = useMemo(() => {
    const fromTag = blurHash?.trim()
    if (fromTag) return fromTag
    const u = url?.trim()
    if (!u) return undefined
    return blurHashPlaceholderForMediaUrl(u)
  }, [blurHash, url])

  const clearLoadWatch = () => {
    if (loadWatchRef.current != null) {
      clearTimeout(loadWatchRef.current)
      loadWatchRef.current = null
    }
  }

  useEffect(() => {
    setImageUrl(url)
    loadSettledRef.current = false
    wasInitiallyHeldRef.current = effectiveHoldUntilClick
    const shouldHold = effectiveHoldUntilClick
    setRevealed(!shouldHold)
    setHasError(false)
    setDisplaySkeleton(true)
    setFallbackIndex(0)
    clearLoadWatch()
    if (!url?.trim()) {
      setIsLoading(false)
      setHasError(true)
      setDisplaySkeleton(false)
      return
    }
    setIsLoading(!shouldHold)
  }, [url, effectiveHoldUntilClick])

  const notifyLoaded = useCallback(() => {
    if (loadSettledRef.current) return
    loadSettledRef.current = true
    clearLoadWatch()
    setIsLoading(false)
    setHasError(false)
    // Unmount blurhash/skeleton immediately — keeping z-10 overlay (even at opacity-0) leaves bg-muted/40
    // and canvas layers visible as odd tinted bands until delayed teardown.
    setDisplaySkeleton(false)
  }, [])

  // Cached images are often `complete` before `onLoad` is attached (feed mounts many cards at once).
  useLayoutEffect(() => {
    if (!revealed || badSrc || !imageUrl?.trim() || loadSettledRef.current) return
    const el = imgRef.current
    if (!el) return
    if (el.complete && el.naturalWidth > 0) {
      notifyLoaded()
      return
    }
    if (!effectiveHoldUntilClick && typeof el.decode === 'function') {
      let cancelled = false
      el.decode().then(() => {
        if (!cancelled && el.naturalWidth > 0) notifyLoaded()
      }).catch(() => {})
      return () => {
        cancelled = true
      }
    }
  }, [revealed, badSrc, imageUrl, effectiveHoldUntilClick, notifyLoaded])

  useEffect(() => {
    clearLoadWatch()
    if (badSrc || !url?.trim() || !revealed) return
    // No stall-timeout when not in tap-to-load mode; only that path waits on user-driven reveal.
    if (!wasInitiallyHeldRef.current) return
    loadWatchRef.current = window.setTimeout(() => {
      loadWatchRef.current = null
      setIsLoading(false)
      setDisplaySkeleton(false)
      setHasError(true)
    }, IMAGE_LOAD_TIMEOUT_MS)
    return clearLoadWatch
  }, [imageUrl, badSrc, url, revealed])

  if (hideIfError && showErrorState) return null

  const handleError = () => {
    clearLoadWatch()
    if (fallback && fallbackIndex < fallback.length) {
      const next = fallback[fallbackIndex]
      setFallbackIndex((prev) => prev + 1)
      loadSettledRef.current = false
      setImageUrl(next)
      return
    }
    setIsLoading(false)
    setDisplaySkeleton(false)
    setHasError(true)
  }

  const handleLoad = () => {
    notifyLoaded()
  }

  const reserveStyle = wrapperReserveStyle(dim, showErrorState)
  const mergedWrapperStyle: CSSProperties | undefined =
    reserveStyle || wrapperStyleProp
      ? { ...reserveStyle, ...wrapperStyleProp }
      : undefined

  const handleReveal = () => {
    if (revealed) return
    setRevealed(true)
    setIsLoading(true)
  }

  const handleWrapperClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (effectiveHoldUntilClick && !revealed) handleReveal()
    onClick?.(e)
  }

  return (
    <span
      className={cn('relative overflow-hidden block w-full', classNames.wrapper)}
      style={mergedWrapperStyle}
      onClick={handleWrapperClick}
      {...props}
    >
      {displaySkeleton && !showErrorState && (
        <span className="absolute inset-0 z-10 block rounded-lg bg-muted/40">
          {effectiveBlurHash ? (
            <BlurHashCanvas
              blurHash={effectiveBlurHash}
              className={cn(
                'absolute inset-0 transition-opacity duration-500 rounded-lg',
                // Keep placeholder visible while the full image is still loading (auto-load),
                // otherwise both blur and <img> are opacity-0 and only a faint bg shows (looks like a white box).
                !revealed || isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          ) : !revealed && !isLoading ? (
            // Static bg when held — no shimmer animation flashing indefinitely
            <span className="absolute inset-0 h-full w-full rounded-lg bg-muted" />
          ) : (
            <Skeleton
              className={cn(
                'absolute inset-0 h-full min-h-[8rem] w-full transition-opacity duration-500 rounded-lg',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          )}
          {!revealed && effectiveHoldUntilClick && fileSizeBytes != null && (
            <span className="absolute bottom-2 right-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm select-none pointer-events-none">
              {formatFileSize(fileSizeBytes)}
            </span>
          )}
        </span>
      )}
      {!showErrorState && revealed && (
        <img
          ref={imgRef}
          src={imageUrl}
          alt={finalAlt}
          title={finalAlt || undefined}
          referrerPolicy="no-referrer"
          decoding={effectiveHoldUntilClick ? 'async' : 'sync'}
          // `lazy` often never starts the request inside nested feed scrollers; always-load should fetch eagerly.
          loading="eager"
          {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
          draggable={false}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'object-cover rounded-lg w-full h-full transition-opacity duration-500 pointer-events-none',
            isLoading ? 'opacity-0' : 'opacity-100',
            className
          )}
          width={dim?.width}
          height={dim?.height}
        />
      )}
      {showErrorState && (
        // All children are <span> so this block is inline-safe when Image is placed
        // inside a <p> by MarkdownArticle (avoids validateDOMNesting violations).
        <span
          role="alert"
          className={cn(
            'flex flex-col items-center justify-center gap-2 w-full min-h-[120px] p-4 rounded-lg bg-muted text-muted-foreground text-center',
            className,
            classNames.errorPlaceholder
          )}
        >
          <span className="flex shrink-0 text-muted-foreground [&_svg]:size-10">{errorPlaceholder}</span>
          <span className="text-sm leading-snug">{t('This image could not be loaded.')}</span>
          {badSrc && !hasError ? (
            <span className="text-xs opacity-80 break-all max-w-full block">{t('Invalid or unsupported image address.')}</span>
          ) : null}
          {openLinkHref ? (
            <a
              href={openLinkHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline break-all max-w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {t('Open image link')}
            </a>
          ) : null}
        </span>
      )}
    </span>
  )
}

const blurHashWidth = 32
const blurHashHeight = 32
function BlurHashCanvas({ blurHash, className = '' }: { blurHash: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const pixels = useMemo(() => {
    if (!blurHash) return null
    try {
      return decode(blurHash, blurHashWidth, blurHashHeight)
    } catch {
      return null
    }
  }, [blurHash])

  useLayoutEffect(() => {
    if (!pixels || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(blurHashWidth, blurHashHeight)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
  }, [pixels])

  if (!blurHash) return null

  // Failed decode or unsupported hash: empty <canvas> often paints as solid white — use muted fill instead.
  if (!pixels) {
    return (
      <span
        className={cn('block h-full w-full rounded-lg bg-muted object-cover', className)}
        aria-hidden
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      width={blurHashWidth}
      height={blurHashHeight}
      className={cn('h-full w-full object-cover rounded-lg', className)}
      style={{
        imageRendering: 'auto',
        filter: 'blur(0.5px)'
      }}
    />
  )
}
