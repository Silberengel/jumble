import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { markMediaUrlRevealed, wasMediaUrlRevealed } from '@/lib/revealed-media-session'
import {
  isRenderableMediaUrl,
  isSafeMediaUrl,
  primalR2aMirrorForBlossomPrimalUrl,
  primalR2aUploads2UrlFromSha256,
  resolvePrimalBlossomPlayableUrl
} from '@/lib/url'
import { TImetaInfo } from '@/types'
import { blurHashPlaceholderForMediaUrl } from '@/lib/media-placeholder-blurhash'
import { decode } from 'blurhash'
import { Image as ImageIcon, ImageOff } from 'lucide-react'
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
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { useTranslation } from 'react-i18next'

/** Browsers often never fire `onError` for invalid URIs, ORB, or stalled fetches — this forces a visible error. */
const IMAGE_LOAD_TIMEOUT_MS = 10_000

/**
 * Without reserved height, `absolute` skeleton + `opacity-0` img collapse to 0×0 — looks like “nothing”.
 * The tall `minHeight` fallback is only for that placeholder phase; keeping it after load (with no `dim`)
 * leaves a box taller than the `<img>` when `height:100%` cannot resolve, which often reads as a white band
 * under transparent GIFs or in dark UI.
 */
function wrapperReserveStyle(
  dim: { width: number; height: number } | undefined,
  showError: boolean,
  useMinHeightPlaceholder: boolean
): CSSProperties | undefined {
  if (showError) return undefined
  if (dim && dim.width > 0 && dim.height > 0) {
    return { aspectRatio: `${dim.width} / ${dim.height}` }
  }
  if (useMinHeightPlaceholder) {
    return { minHeight: 'min(30vh, 280px)' }
  }
  return undefined
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${Math.round(bytes / 1_024)} KB`
  return `${bytes} B`
}

function extensionWithDotFromUrl(url: string): string {
  try {
    const m = new URL(url).pathname.match(/(\.[a-z0-9]+)$/i)
    return m?.[1]?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

export default function Image({
  image: { url, blurHash, dim, alt: imetaAlt, fallback, size: fileSizeBytes, x: imetaHash, pubkey },
  alt,
  className = '',
  classNames = {},
  hideIfError = false,
  /** Called after internal URL fallbacks are exhausted and the image still failed to load. */
  onFinalError,
  errorPlaceholder = <ImageOff />,
  style: wrapperStyleProp,
  holdUntilClick = false,
  fetchPriority,
  loading = 'eager',
  onClick,
  showAltCaption = false,
  caption,
  /** Native tooltip on hover (e.g. Markdown `![alt](url "title")`). When set, overrides alt-as-title on `<img>`. */
  tooltipTitle,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  classNames?: {
    wrapper?: string
    errorPlaceholder?: string
  }
  image: TImetaInfo
  alt?: string
  /** Shown as the `<img title>` tooltip when non-empty. */
  tooltipTitle?: string
  /** When true, show {@link caption} or non-empty alt below the image (lightbox-style caption). */
  showAltCaption?: boolean
  /** Caption below the image; defaults to resolved alt when {@link showAltCaption} is true. */
  caption?: string
  hideIfError?: boolean
  onFinalError?: () => void
  errorPlaceholder?: React.ReactNode
  /** Passed to the inner `<img>` (e.g. profile banner vs avatar load order). */
  fetchPriority?: 'high' | 'low' | 'auto'
  /** Native lazy loading — use `lazy` for below-the-fold grids; default `eager` for feeds. */
  loading?: 'lazy' | 'eager'
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
  const autoLoadForAuthor = useShouldAutoLoadMedia(pubkey)
  /** Tap-to-load only if the parent asked and policy allows (or there is no policy — trust the parent). */
  const effectiveHoldUntilClick = holdUntilClick && !autoLoadForAuthor

  const urlOk = !!url?.trim()
  const [revealed, setRevealed] = useState(!effectiveHoldUntilClick)
  const [isLoading, setIsLoading] = useState(urlOk && !effectiveHoldUntilClick)
  const [displaySkeleton, setDisplaySkeleton] = useState(urlOk)
  const [hasError, setHasError] = useState(!urlOk)
  const [imageUrl, setImageUrl] = useState(() => resolvePrimalBlossomPlayableUrl(url ?? ''))
  const [fallbackIndex, setFallbackIndex] = useState(0)
  const loadWatchRef = useRef<number | null>(null)
  /** After r2a + imeta fallbacks fail, try `url` on blossom.primal.net once (see handleError). */
  const triedPrimaryBlossomDirectRef = useRef(false)
  const triedR2aFromHashRef = useRef(false)
  const userRevealedRef = useRef(false)
  // Kept in sync in the reset effect; load-timeout runs only while tap-to-load is actually active.
  const wasInitiallyHeldRef = useRef(effectiveHoldUntilClick)
  const imgRef = useRef<HTMLImageElement | null>(null)
  /** Deduplicate onLoad vs sync cache hit vs decode() — otherwise blurhash can stick when `onLoad` never runs. */
  const loadSettledRef = useRef(false)
  /** When imeta has no `dim`, reserve space from decoded natural size to avoid mobile layout shift. */
  const [intrinsicDim, setIntrinsicDim] = useState<{ width: number; height: number } | undefined>()

  const finalAlt = imetaAlt || alt
  const imgTitle =
    tooltipTitle != null && String(tooltipTitle).trim() !== ''
      ? String(tooltipTitle).trim()
      : (() => {
          const a = (finalAlt ?? '').trim()
          // Markdown uses `alt="image"` when `![](url)` has no label — not a real caption/tooltip.
          return a && a !== 'image' ? a : undefined
        })()
  const captionLine = (() => {
    if (!showAltCaption) return ''
    const c = (caption ?? finalAlt ?? '').trim()
    if (c && c !== 'image') return c
    return ''
  })()
  const openLinkHref =
    (isSafeMediaUrl(url) && url.trim()) || (isSafeMediaUrl(imageUrl) && imageUrl.trim()) || ''

  const badSrc = !imageUrl?.trim() || !isRenderableMediaUrl(imageUrl.trim())
  const showErrorState = hasError || badSrc
  const effectiveDim =
    dim && dim.width > 0 && dim.height > 0 ? dim : intrinsicDim

  const captureIntrinsicDim = useCallback(
    (el: HTMLImageElement) => {
      if (dim && dim.width > 0 && dim.height > 0) return
      const w = el.naturalWidth
      const h = el.naturalHeight
      if (w <= 0 || h <= 0) return
      setIntrinsicDim((prev) =>
        prev?.width === w && prev?.height === h ? prev : { width: w, height: h }
      )
    },
    [dim]
  )

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
    setImageUrl(resolvePrimalBlossomPlayableUrl(url ?? ''))
    loadSettledRef.current = false
    setIntrinsicDim(undefined)
    wasInitiallyHeldRef.current = effectiveHoldUntilClick
    const shouldHold = effectiveHoldUntilClick
    const sessionRevealed = Boolean(url?.trim() && wasMediaUrlRevealed(url))
    const showImmediately = !shouldHold || userRevealedRef.current || sessionRevealed
    setRevealed(showImmediately)
    setHasError(false)
    setDisplaySkeleton(true)
    setFallbackIndex(0)
    triedPrimaryBlossomDirectRef.current = false
    triedR2aFromHashRef.current = false
    clearLoadWatch()
    if (!url?.trim()) {
      setIsLoading(false)
      setHasError(true)
      setDisplaySkeleton(false)
      return
    }
    setIsLoading(showImmediately)
  }, [url, effectiveHoldUntilClick])

  const notifyLoaded = useCallback(() => {
    if (loadSettledRef.current) return
    loadSettledRef.current = true
    clearLoadWatch()
    const el = imgRef.current
    if (el) captureIntrinsicDim(el)
    setIsLoading(false)
    setHasError(false)
    // Unmount blurhash/skeleton immediately — keeping z-10 overlay (even at opacity-0) leaves bg-muted/40
    // and canvas layers visible as odd tinted bands until delayed teardown.
    setDisplaySkeleton(false)
  }, [captureIntrinsicDim])

  // Cached images are often `complete` before `onLoad` is attached (feed mounts many cards at once).
  useLayoutEffect(() => {
    if (!revealed || badSrc || !imageUrl?.trim() || loadSettledRef.current) return
    const el = imgRef.current
    if (!el) return
    if (el.complete && el.naturalWidth > 0) {
      captureIntrinsicDim(el)
      notifyLoaded()
    }
  }, [revealed, badSrc, imageUrl, notifyLoaded, captureIntrinsicDim])

  useEffect(() => {
    clearLoadWatch()
    if (badSrc || !url?.trim() || !revealed) return
    // No stall-timeout when not in tap-to-load mode; only that path waits on user-driven reveal.
    if (!wasInitiallyHeldRef.current) return
    loadWatchRef.current = window.setTimeout(() => {
      loadWatchRef.current = null
      const el = imgRef.current
      if (el?.complete && el.naturalWidth > 0) {
        notifyLoaded()
        return
      }
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
      setImageUrl(resolvePrimalBlossomPlayableUrl(next))
      return
    }
    // r2a mirror sometimes 404s while blossom.primal.net still serves (redirect chain). Retry canonical URL once.
    const primary = (url ?? '').trim()
    const mirrorOfPrimary = primary ? primalR2aMirrorForBlossomPrimalUrl(primary) : null
    if (
      mirrorOfPrimary &&
      primary !== mirrorOfPrimary &&
      !triedPrimaryBlossomDirectRef.current
    ) {
      triedPrimaryBlossomDirectRef.current = true
      loadSettledRef.current = false
      setImageUrl(primary)
      return
    }
    const hash = imetaHash?.trim().toLowerCase()
    if (hash && !triedR2aFromHashRef.current) {
      const r2a = primalR2aUploads2UrlFromSha256(hash, extensionWithDotFromUrl(primary || imageUrl))
      if (r2a && imageUrl !== r2a) {
        triedR2aFromHashRef.current = true
        loadSettledRef.current = false
        setImageUrl(r2a)
        return
      }
    }
    setIsLoading(false)
    setDisplaySkeleton(false)
    setHasError(true)
    onFinalError?.()
  }

  const handleLoad = () => {
    notifyLoaded()
  }

  const reserveStyle = wrapperReserveStyle(
    effectiveDim,
    showErrorState,
    displaySkeleton && !showErrorState && !effectiveDim
  )
  const mergedWrapperStyle: CSSProperties | undefined =
    reserveStyle || wrapperStyleProp
      ? { ...reserveStyle, ...wrapperStyleProp }
      : undefined

  const handleReveal = () => {
    if (revealed) return
    userRevealedRef.current = true
    if (url?.trim()) markMediaUrlRevealed(url)
    setRevealed(true)
    setIsLoading(true)
  }

  const handleWrapperClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (effectiveHoldUntilClick && !revealed) handleReveal()
    onClick?.(e)
  }

  const hasHoverTip = Boolean(imgTitle)
  const showTapToRevealChrome = !showErrorState && !revealed && effectiveHoldUntilClick
  const tapToRevealLabel = t('Click to load image')

  return (
    <span className={cn('block w-full not-prose', classNames.wrapper)}>
      <span
        className={cn(
          'relative overflow-hidden block w-full rounded-lg bg-background',
          showTapToRevealChrome && 'group cursor-zoom-in',
          hasHoverTip && 'cursor-help ring-1 ring-inset ring-dotted ring-muted-foreground/45'
        )}
        style={mergedWrapperStyle}
        title={showTapToRevealChrome ? tapToRevealLabel : imgTitle}
        role={showTapToRevealChrome ? 'button' : undefined}
        aria-label={showTapToRevealChrome ? tapToRevealLabel : undefined}
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
      {showTapToRevealChrome && (
        <>
          <span
            className="absolute inset-0 z-[15] bg-gradient-to-t from-black/55 via-black/25 to-black/15 pointer-events-none"
            aria-hidden
          />
          <span className="absolute inset-0 z-[20] grid place-items-center pointer-events-none" aria-hidden>
            <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-[2px] transition-transform group-hover:scale-105">
              <ImageIcon className="size-7" strokeWidth={2} />
            </span>
          </span>
        </>
      )}
      {!showErrorState && revealed && (
        <img
          ref={imgRef}
          src={imageUrl}
          alt={finalAlt}
          referrerPolicy="no-referrer-when-downgrade"
          decoding="async"
          loading={loading}
          {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
          draggable={false}
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'object-cover rounded-lg w-full h-full transition-opacity duration-500 pointer-events-none',
            isLoading ? 'opacity-0' : 'opacity-100',
            className
          )}
          width={effectiveDim?.width ?? dim?.width}
          height={effectiveDim?.height ?? dim?.height}
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
              className="text-sm text-primary underline-offset-4 hover:text-foreground hover:underline transition-colors break-all max-w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {t('Open image link')}
            </a>
          ) : null}
        </span>
      )}
      </span>
      {captionLine ? (
        <span className="mt-1 block px-1 text-center text-xs leading-snug text-muted-foreground">{captionLine}</span>
      ) : null}
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
