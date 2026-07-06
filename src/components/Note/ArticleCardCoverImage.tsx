import ContentImage from '@/components/Image'
import UserAvatar from '@/components/UserAvatar'
import { useShouldAutoLoadMedia } from '@/hooks/useShouldAutoLoadMedia'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'

/**
 * Long-form / wiki–style card cover: NIP-23 `image` tag when present, otherwise the author avatar.
 */
export default function ArticleCardCoverImage({
  event,
  imageUrl,
  autoLoadMedia: autoLoadMediaProp,
  layout,
  hideImageIfError = false
}: {
  event: Event
  imageUrl?: string
  /** Deprecated: prefer per-author policy via {@link useShouldAutoLoadMedia}. Kept for callers that pass it. */
  autoLoadMedia?: boolean
  /** `stacked-full`: image on top spanning the whole card width (vertical cards). */
  layout: 'stacked' | 'stacked-full' | 'row'
  /** Passed through to {@link ContentImage} when an `image` tag URL exists. */
  hideImageIfError?: boolean
}) {
  const autoLoadFromPolicy = useShouldAutoLoadMedia(event.pubkey, event)
  const autoLoadMedia = autoLoadMediaProp ?? autoLoadFromPolicy
  const trimmed = imageUrl?.trim()
  if (trimmed) {
    return (
      <ContentImage
        image={{ url: trimmed, pubkey: event.pubkey }}
        className={
          layout === 'stacked'
            ? 'mb-3 aspect-video w-full max-w-[400px]'
            : layout === 'stacked-full'
              ? 'mb-3 aspect-video w-full object-cover'
              : 'w-full rounded-lg bg-foreground object-cover aspect-[4/3] xl:aspect-video'
        }
        classNames={
          layout === 'row' ? { wrapper: 'w-2/5 max-w-[200px] shrink-0' } : undefined
        }
        hideIfError={hideImageIfError}
        holdUntilClick={!autoLoadMedia}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center overflow-hidden rounded-lg bg-muted',
        layout === 'stacked' && 'mb-3 h-44 w-full max-w-[400px]',
        layout === 'stacked-full' && 'mb-3 h-44 w-full',
        layout === 'row' && 'w-2/5 max-w-[200px] shrink-0 aspect-square'
      )}
    >
      <UserAvatar
        userId={event.pubkey}
        size="large"
        deferRemoteAvatar={false}
        className={cn(
          'rounded-xl',
          layout === 'row'
            ? '!h-3/5 !w-3/5 max-h-[7.5rem] max-w-[7.5rem]'
            : '!h-[7.5rem] !w-[7.5rem]'
        )}
      />
    </div>
  )
}
