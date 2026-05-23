import MarkdownArticle from './MarkdownArticle/MarkdownArticle'
import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'

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
        'prose-xl max-w-none text-foreground',
        '[&_p]:text-[1.6875rem] [&_p]:font-semibold [&_p]:leading-snug [&_p]:text-foreground',
        '[&_a]:text-[hsl(var(--uri-link))] [&_a:hover]:text-[hsl(var(--primary))]',
        '[&_strong]:text-foreground [&_em]:text-foreground',
        className
      )}
    />
  )
}
