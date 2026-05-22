import { isFaviconLoadFailed, markFaviconLoadFailed, normalizeFaviconDomain } from '@/lib/favicon-fail-cache'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const loadingRef = useRef(loading)
  loadingRef.current = loading

  useEffect(() => {
    const knownFailed = !host || isFaviconLoadFailed(host)
    setError(knownFailed)
    setLoading(!knownFailed)
    if (!host || knownFailed) return
    return () => {
      if (loadingRef.current) markFaviconLoadFailed(host)
    }
  }, [host])

  if (error || !host) return fallback

  return (
    <div className={cn('relative', className)}>
      {loading && <div className={cn('absolute inset-0', className)}>{fallback}</div>}
      <img
        src={`https://${host}/favicon.ico`}
        alt={host}
        className={cn('absolute inset-0', loading && 'opacity-0', className)}
        onError={() => {
          markFaviconLoadFailed(host)
          setError(true)
        }}
        onLoad={() => {
          loadingRef.current = false
          setLoading(false)
        }}
      />
    </div>
  )
}
