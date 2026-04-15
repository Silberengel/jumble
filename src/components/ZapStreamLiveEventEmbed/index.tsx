import { EmbeddedNote } from '@/components/Embedded/EmbeddedNote'
import ExternalLink from '@/components/ExternalLink'
import { liveActivityKindsEnabledInPicker } from '@/lib/live-activities'
import { naddrFromZapStreamWatchUrl } from '@/lib/zap-stream-url'
import { cn } from '@/lib/utils'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import type { Event } from 'nostr-tools'

/** zap.stream `/naddr1…` → fetch kind 30311 and render as embedded note (LiveEvent), not a full-site iframe. */
export default function ZapStreamLiveEventEmbed({
  url,
  className,
  containingEvent,
  showFull
}: {
  url: string
  className?: string
  containingEvent?: Event
  showFull?: boolean
}) {
  const { showKinds, feedKindFilterBypass } = useKindFilterOrDefaults()
  if (!liveActivityKindsEnabledInPicker(showKinds, feedKindFilterBypass)) {
    return <ExternalLink url={url} className={cn('not-prose', className)} />
  }
  const naddr = naddrFromZapStreamWatchUrl(url)
  if (!naddr) {
    return <ExternalLink url={url} className={cn('not-prose', className)} />
  }
  return (
    <EmbeddedNote
      noteId={naddr}
      className={cn('not-prose', className)}
      containingEvent={containingEvent}
      showFull={showFull}
    />
  )
}
