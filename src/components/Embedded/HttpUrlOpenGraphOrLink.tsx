import WebPreview from '@/components/WebPreview'
import { useFetchWebMetadata } from '@/hooks/useFetchWebMetadata'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { hasUsableOpenGraphMetadata } from '@/lib/open-graph-preview'
import { cleanUrl, isLikelyWebPageUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'
import { EmbeddedNormalUrl } from './EmbeddedNormalUrl'

/**
 * Renders a plain http(s) URL as a hyperlink, or as a WebPreview card when OG metadata exists —
 * never both (avoids redundant link + card).
 */
export function HttpUrlOpenGraphOrLink({
  url,
  containingEvent,
  className,
  block = false
}: {
  url: string
  containingEvent?: Event
  className?: string
  /** Block layout for tag-only links; inline for prose autolinks. */
  block?: boolean
}) {
  const cleaned = cleanUrl(url) || url
  const autoLoadMedia = useShouldAutoLoadMedia(containingEvent?.pubkey, containingEvent)
  const fetchEnabled = autoLoadMedia && isLikelyWebPageUrl(cleaned)
  const { title, description, image, ogLoading } = useFetchWebMetadata(cleaned, { fetchEnabled })
  const hasOg = hasUsableOpenGraphMetadata({ title, description, image })

  if (!fetchEnabled || ogLoading || !hasOg) {
    const link = <EmbeddedNormalUrl url={url} />
    return block ? <div className={cn('not-prose max-w-full', className)}>{link}</div> : link
  }

  return (
    <div className={cn('not-prose max-w-full', block && 'mt-2', className)}>
      <WebPreview
        url={cleaned}
        className="w-full"
        authorPubkey={containingEvent?.pubkey}
        sourceEvent={containingEvent}
        prefetchedOpenGraph={{
          title: title ?? undefined,
          description: description ?? undefined,
          image: image ?? undefined
        }}
      />
    </div>
  )
}
