import { useEmojiInfosForEvent } from '@/hooks'
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
  return <Content content={event.content} className={className} emojiInfos={emojiInfos} />
}
