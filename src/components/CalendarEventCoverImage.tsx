import { useFetchProfile } from '@/hooks'
import { toNostrBuildThumbUrl } from '@/lib/nostr-build'
import { isSafeMediaUrl, isVideo } from '@/lib/url'
import { cn } from '@/lib/utils'
import { Calendar } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

function profileAvatarThumbUrl(avatar: string | undefined): string {
  const a = avatar?.trim()
  if (!a || !/^https?:\/\//i.test(a)) return ''
  if (isVideo(a)) return a
  return toNostrBuildThumbUrl(a)
}

/**
 * NIP-52 calendar card cover: event `image` tag, else author profile picture, else calendar icon.
 */
export function CalendarEventCoverImage({
  coverUrl,
  pubkey,
  className,
  iconClassName
}: {
  coverUrl: string
  pubkey: string
  className?: string
  /** Passed to the Lucide {@link Calendar} icon when event image and profile avatar are unavailable. */
  iconClassName?: string
}) {
  const trimmedCover = coverUrl?.trim() ?? ''
  const safeCover = isSafeMediaUrl(trimmedCover) ? trimmedCover : ''
  const { profile } = useFetchProfile(pubkey)
  const profileThumb = useMemo(() => profileAvatarThumbUrl(profile?.avatar), [profile?.avatar])

  const [profileImgFailed, setProfileImgFailed] = useState(false)
  useEffect(() => {
    setProfileImgFailed(false)
  }, [profileThumb, safeCover, pubkey])

  if (safeCover) {
    return (
      <img
        src={safeCover}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn('object-cover shadow-sm ring-1 ring-border/40', className)}
      />
    )
  }

  if (profileThumb && !profileImgFailed) {
    return (
      <img
        src={profileThumb}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn('object-cover shadow-sm ring-1 ring-border/40', className)}
        onError={() => setProfileImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center bg-primary/10 shadow-sm ring-1 ring-border/40',
        className
      )}
    >
      <Calendar className={cn('text-primary/80', iconClassName ?? 'size-7')} aria-hidden />
    </div>
  )
}
