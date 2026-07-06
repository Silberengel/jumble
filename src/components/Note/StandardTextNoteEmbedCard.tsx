import type { ReactNode } from 'react'
import NormalContentPreview from '@/components/ContentPreview/NormalContentPreview'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'

/**
 * Compact, consistent card for kind-1 (and text-like) embedded / quoted notes.
 * Used in feed embeds, stringified repost targets, and notification context previews.
 */
export default function StandardTextNoteEmbedCard({
  event,
  className,
  lineClampClassName = 'line-clamp-4',
  deferAuthorAvatar = false,
  header
}: {
  event: Event
  className?: string
  lineClampClassName?: string
  deferAuthorAvatar?: boolean
  /** Optional row above the author (e.g. boost label). */
  header?: ReactNode
}) {
  return (
    <div
      data-embedded-note
      className={cn(
        'not-prose rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm',
        className
      )}
    >
      {header ? <div className="mb-2">{header}</div> : null}
      <div className="flex min-w-0 gap-2">
        <UserAvatar
          userId={event.pubkey}
          size="tiny"
          className="mt-0.5 shrink-0"
          deferRemoteAvatar={deferAuthorAvatar}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <Username
            userId={event.pubkey}
            className="min-w-0 truncate text-sm font-semibold leading-tight"
            skeletonClassName="h-4"
          />
          <NormalContentPreview event={event} className={cn('text-sm text-foreground/95', lineClampClassName)} />
        </div>
      </div>
    </div>
  )
}
