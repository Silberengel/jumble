import { isFaviconLoadFailed, markFaviconLoadFailed, normalizeFaviconDomain } from '@/lib/favicon-fail-cache'
import { getDomainIconFallbackGlyph } from '@/lib/nip05-affiliation'
import { getDomainIconOverrideSrc } from '@/lib/relay-icon-source'
import { cn } from '@/lib/utils'
import { useEffect, useMemo, useState } from 'react'

export function Favicon({
  domain,
  className,
  fallback = null
}: {
  domain: string
  className?: string
  fallback?: React.ReactNode
}) {
  const host = normalizeFaviconDomain(domain)
  const glyph = useMemo(() => getDomainIconFallbackGlyph(host), [host])
  const iconSrc = useMemo(
    () =>
      glyph || !host
        ? undefined
        : (getDomainIconOverrideSrc(host) ?? `https://${host}/favicon.ico`),
    [glyph, host]
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (glyph) return
    const knownFailed = !iconSrc || isFaviconLoadFailed(iconSrc)
    setError(knownFailed)
    setLoading(!knownFailed)
  }, [glyph, iconSrc])

  if (glyph) {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center leading-none select-none', className)}
        aria-hidden
      >
        {glyph}
      </span>
    )
  }

  if (error || !iconSrc) return fallback

  return (
    <div className={cn('relative', className)}>
      {loading && <div className={cn('absolute inset-0', className)}>{fallback}</div>}
      <img
        src={iconSrc}
        alt={host}
        className={cn('absolute inset-0 object-cover object-center', loading && 'opacity-0', className)}
        onError={() => {
          markFaviconLoadFailed(iconSrc)
          setError(true)
        }}
        onLoad={() => {
          setLoading(false)
        }}
      />
    </div>
  )
}
