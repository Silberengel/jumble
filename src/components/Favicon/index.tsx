import { isFaviconLoadFailed, markFaviconLoadFailed, normalizeFaviconDomain } from '@/lib/favicon-fail-cache'
import { cn } from '@/lib/utils'
import { useState } from 'react'

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
  const knownFailed = host ? isFaviconLoadFailed(host) : true
  const [loading, setLoading] = useState(!knownFailed)
  const [error, setError] = useState(knownFailed)
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
        onLoad={() => setLoading(false)}
      />
    </div>
  )
}
