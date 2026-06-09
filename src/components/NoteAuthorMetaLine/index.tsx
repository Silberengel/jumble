import Nip05AffiliationBadges from '@/components/Nip05AffiliationBadges'
import UserStatusBadge from '@/components/UserStatusBadge'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import EventPowLabel from '@/components/EventPowLabel'
import Username from '@/components/Username'
import { cn } from '@/lib/utils'
import type { Event } from 'nostr-tools'

/** Username, relative time, verified NIP-05 affiliation badges, optional PoW — one header row. */
export default function NoteAuthorMetaLine({
  userId,
  timestamp,
  powEvent,
  usernameClassName,
  skeletonClassName,
  timestampShort = false
}: {
  userId: string
  timestamp: number
  powEvent?: Event
  usernameClassName?: string
  skeletonClassName?: string
  timestampShort?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Username
          userId={userId}
          className={cn('shrink font-semibold truncate', usernameClassName)}
          skeletonClassName={skeletonClassName}
        />
        <span className="inline-flex min-w-0 shrink-0 items-center gap-x-1.5 text-sm text-muted-foreground">
          <FormattedTimestamp timestamp={timestamp} className="shrink-0" short={timestampShort} />
          <Nip05AffiliationBadges userId={userId} />
          {powEvent ? <EventPowLabel event={powEvent} /> : null}
        </span>
      </div>
      <UserStatusBadge userId={userId} quiet className="w-full" />
    </div>
  )
}
