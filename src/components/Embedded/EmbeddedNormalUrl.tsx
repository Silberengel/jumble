import { URI_LINK_CLASS } from '@/lib/link-styles'
import { cleanUrl } from '@/lib/url'
import React from 'react'

export function EmbeddedNormalUrl({ url, children }: { url: string; children?: React.ReactNode }) {
  // Clean tracking parameters from URLs before displaying/linking
  const cleanedUrl = cleanUrl(url)
  
  // Render all URLs as green text links (like hashtags) - WebPreview cards shown at bottom
  return (
    <a
      className={URI_LINK_CLASS}
      href={cleanedUrl}
      target="_blank"
      onClick={(e) => e.stopPropagation()}
      rel="noreferrer noopener"
    >
      {children || cleanedUrl}
    </a>
  )
}
