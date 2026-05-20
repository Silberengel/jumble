import { URI_LINK_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'
import { cleanUrl } from '@/lib/url'

export default function ExternalLink({ url, className }: { url: string; className?: string }) {
  const cleanedUrl = cleanUrl(url)
  return (
    <a
      className={cn(URI_LINK_CLASS, className)}
      href={cleanedUrl}
      target="_blank"
      onClick={(e) => e.stopPropagation()}
      rel="noreferrer noopener"
    >
      {cleanedUrl}
    </a>
  )
}
