import { Event } from 'nostr-tools'
import Content from '../Content'

export default function VideoNote({
  event,
  className,
  loadMedia = false
}: {
  event: Event
  className?: string
  /** When true (note detail / expanded view), long-form video may autoload. */
  loadMedia?: boolean
}) {
  // Content component already handles all media rendering (from content and tags)
  // with proper deduplication, so we don't need to add anything extra
  return (
    <div className={className}>
      <Content event={event} mustLoadMedia={loadMedia} />
    </div>
  )
}
