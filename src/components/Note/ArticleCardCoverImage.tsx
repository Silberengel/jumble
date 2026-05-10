import ContentImage from '@/components/Image'
import UserAvatar from '@/components/UserAvatar'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'

/**
 * Long-form / wiki–style card cover: NIP-23 `image` tag when present, otherwise the author avatar.
 */
export default function ArticleCardCoverImage({
  event,
  imageUrl,
  autoLoadMedia,
  layout,
  hideImageIfError = false
}: {
  event: Event
  imageUrl?: string
  autoLoadMedia: boolean
  layout: 'stacked' | 'row'
  /** Passed through to {@link ContentImage} when an `image` tag URL exists. */
  hideImageIfError?: boolean
}) {
  const trimmed = imageUrl?.trim()
  if (trimmed && autoLoadMedia) {
    return (
      <ContentImage
        image={{ url: trimmed, pubkey: event.pubkey }}
        className={
          layout === 'stacked'
            ? 'mb-3 aspect-video w-full max-w-[400px]'
            : 'h-44 max-w-[400px] shrink rounded-lg bg-foreground object-cover aspect-[4/3] xl:aspect-video'
        }
        classNames={layout === 'row' ? { wrapper: 'w-auto max-w-[400px] shrink-0' } : undefined}
        hideIfError={hideImageIfError}
      />
    )
  }
  if (trimmed) return null

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg bg-muted',
        layout === 'stacked'
          ? 'mb-3 h-44 w-full max-w-[400px]'
          : 'h-44 w-auto max-w-[400px] shrink-0 aspect-[4/3] xl:aspect-video'
      )}
    >
      <UserAvatar
        userId={event.pubkey}
        size="large"
        deferRemoteAvatar={false}
        className="!h-[7.5rem] !w-[7.5rem] rounded-xl"
      />
    </div>
  )
}
