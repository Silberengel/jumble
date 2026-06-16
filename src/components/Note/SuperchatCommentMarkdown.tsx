import { superchatCommentBodyClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import MarkdownArticle from './LazyMarkdownArticle'

export default function SuperchatCommentMarkdown({
  event,
  comment,
  className
}: {
  event: Event
  comment: string
  className?: string
}) {
  const previewEvent = useMemo(
    () => ({ ...event, content: comment }) as Event,
    [event, comment]
  )

  return (
    <MarkdownArticle
      event={previewEvent}
      hideMetadata
      lazyMedia={false}
      className={cn(
        superchatCommentBodyClass,
        '[&_a]:text-[hsl(var(--uri-link))] [&_a:hover]:text-[hsl(var(--primary))]',
        '[&_strong]:text-foreground [&_em]:text-foreground',
        className
      )}
    />
  )
}
