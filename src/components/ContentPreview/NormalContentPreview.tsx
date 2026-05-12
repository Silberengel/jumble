import { useEmojiInfosForEvent } from '@/hooks'
import { stripTrailingStringifiedNostrEvent } from '@/lib/nostr-event-json'
import { Event } from 'nostr-tools'
import Content from './Content'

export default function NormalContentPreview({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const emojiInfos = useEmojiInfosForEvent(event)
  const content = stripTrailingStringifiedNostrEvent(event.content)
  return <Content content={content} className={className} emojiInfos={emojiInfos} />
}
