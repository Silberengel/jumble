import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useFetchRelayInfo } from '@/hooks'
import {
  getRelayIconFallbackGlyph,
  getRelayIconOverrideSrc,
  relayUrlFingerprintColors
} from '@/lib/relay-icon-source'
import { cn } from '@/lib/utils'
import type { TRelayInfo } from '@/types'
import { Server } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

/**
 * Resolve an image URL from NIP-11.  Handles:
 * - Absolute HTTP(S) URLs → used as-is
 * - Relative paths (e.g. "/logo.png") → resolved against the relay's base HTTP URL
 * - ws(s):// URLs some relays mistakenly return → ignored
 *
 * We do not fetch `https://host/favicon.ico` as a fallback: many relays return HTML/404 there,
 * which triggers Firefox Opaque Response Blocking noise and broken `<img>` loads.
 */
function resolveRelayImageUrl(raw: string, relayUrl: string): string | undefined {
  if (!raw) return undefined
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw
  if (raw.startsWith('/')) {
    try {
      const base = relayUrl.replace(/^wss?:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
      const u = new URL(base)
      return `${u.protocol}//${u.host}${raw}`
    } catch {
      return undefined
    }
  }
  return undefined
}

export default function RelayIcon({
  url,
  className,
  iconSize = 14,
  /** When set, used instead of fetching NIP-11 (e.g. parent batched {@link relayInfoService.getRelayInfos}). */
  relayInfo: relayInfoProp,
  /** When true, do not hit NIP-11 (parent already fetches relay info, or icon-only row). */
  skipRelayInfoFetch = false
}: {
  url?: string
  className?: string
  iconSize?: number
  relayInfo?: TRelayInfo
  skipRelayInfoFetch?: boolean
}) {
  const { relayInfo: fetchedRelayInfo } = useFetchRelayInfo(
    relayInfoProp !== undefined || skipRelayInfoFetch ? undefined : url
  )
  const relayInfo = relayInfoProp !== undefined ? relayInfoProp : fetchedRelayInfo
  const [iconLoadFailed, setIconLoadFailed] = useState(false)
  useEffect(() => {
    setIconLoadFailed(false)
  }, [url, relayInfo?.icon])
  const iconUrl = useMemo(() => {
    if (!url) return undefined

    const override = getRelayIconOverrideSrc(url)
    if (override) {
      return override
    }

    // Prefer the NIP-11 icon field
    const rawIcon = relayInfo?.icon && typeof relayInfo.icon === 'string' ? relayInfo.icon : undefined
    const nip11Icon = rawIcon ? resolveRelayImageUrl(rawIcon, url) : undefined
    if (nip11Icon) {
      return nip11Icon
    }

    return undefined
  }, [url, relayInfo])

  const fallbackColors = useMemo(() => relayUrlFingerprintColors(url), [url])
  const fallbackGlyph = useMemo(() => getRelayIconFallbackGlyph(url), [url])

  return (
    <Avatar className={cn('w-6 h-6', className)}>
      {iconUrl && !iconLoadFailed && (
        <AvatarImage
          src={iconUrl}
          className="object-cover object-center"
          onError={() => setIconLoadFailed(true)}
        />
      )}
      <AvatarFallback
        className="bg-transparent"
        style={{ backgroundColor: fallbackColors.background, color: fallbackColors.color }}
      >
        {fallbackGlyph ? (
          <span
            className="leading-none select-none"
            style={{ fontSize: Math.max(12, iconSize + 4) }}
            aria-hidden
          >
            {fallbackGlyph}
          </span>
        ) : (
          <Server size={iconSize} className="opacity-95" aria-hidden />
        )}
      </AvatarFallback>
    </Avatar>
  )
}
