/**
 * Component to display highlight sources (e/a tags or URLs) as embedded events or OpenGraph previews
 */

import { useMemo } from 'react'
import { nip19 } from 'nostr-tools'
import logger from '@/lib/logger'
import { HttpUrlOpenGraphOrLink } from '@/components/Embedded'
import { EmbeddedNote } from '../Embedded/EmbeddedNote'
import { ExternalLink } from 'lucide-react'
import { isLikelyWebPageUrl } from '@/lib/url'

interface HighlightSourcePreviewProps {
  source: {
    type: 'event' | 'addressable' | 'url'
    value: string
    bech32: string
  }
  className?: string
  /** URL sources: render only the OpenGraph card (no bare-link fallback) — e.g. when a "Source:" line already links the URL. */
  ogCardOnly?: boolean
}

export default function HighlightSourcePreview({
  source,
  className,
  ogCardOnly = false
}: HighlightSourcePreviewProps) {
  // Always call hooks first, before any conditional returns
  const alexandriaUrl = useMemo(() => {
    if (source.type === 'url') {
      return source.value
    }
    return `https://next-alexandria.gitcitadel.eu/events?id=${source.bech32}`
  }, [source])

  // Determine what to render without early returns
  let content: JSX.Element | null = null

  if (source.type === 'event') {
    // For events, try to decode and show as embedded note
    try {
      const decoded = nip19.decode(source.bech32)
      if (decoded.type === 'nevent' || decoded.type === 'note') {
        content = (
          <div className="max-h-[300px] overflow-hidden border-b border-gray-200 dark:border-gray-700">
            <EmbeddedNote noteId={source.value} className="w-full" />
          </div>
        )
      }
    } catch (error) {
      logger.warn('Failed to decode nostr event', error as Error)
    }
    
    // If decoding failed, show as Alexandria link
    if (!content) {
      content = (
        <div className={`p-3 border rounded-lg bg-muted/50 ${className}`}>
          <a
            href={alexandriaUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 break-words"
          >
            <span className="font-mono text-sm">
              nevent: {source.value.slice(0, 20)}...
            </span>
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        </div>
      )
    }
  } else if (source.type === 'addressable') {
    // For addressable events, try to decode and show as embedded note
    try {
      const decoded = nip19.decode(source.bech32)
      if (decoded.type === 'naddr') {
        content = (
          <div className="max-h-[300px] overflow-hidden border-b border-gray-200 dark:border-gray-700">
            <EmbeddedNote noteId={source.bech32} className="w-full" />
          </div>
        )
      }
    } catch (error) {
      logger.warn('Failed to decode nostr addressable event', error as Error)
    }
    
    // If decoding failed, show as Alexandria link
    if (!content) {
      content = (
        <div className={`p-3 border rounded-lg bg-muted/50 ${className}`}>
          <a
            href={alexandriaUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 break-words"
          >
            <span className="font-mono text-sm">
              naddr: {source.value.slice(0, 20)}...
            </span>
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        </div>
      )
    }
  } else if (source.type === 'url') {
    if (isLikelyWebPageUrl(source.value)) {
      content = (
        <HttpUrlOpenGraphOrLink url={source.value} block ogCardOnly={ogCardOnly} className="w-full" />
      )
    } else {
      content = (
        <div className={`p-3 border rounded-lg bg-muted/50 ${className}`}>
          <a
            href={source.value.startsWith('nostr:') ? source.value : `nostr:${source.value}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 text-primary hover:underline break-words"
          >
            <span className="font-mono text-sm">{source.value.slice(0, 48)}…</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        </div>
      )
    }
  }

  // Render content in a wrapper div
  return (
    <div className={className}>
      {content}
    </div>
  )
}
