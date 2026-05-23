import { cn } from '@/lib/utils'
import { Event } from 'nostr-tools'
import { useTranslation } from 'react-i18next'
import SuperchatCommentMarkdown from './SuperchatCommentMarkdown'

export default function SuperchatMessageArea({
  event,
  comment,
  showEmptyFallback,
  className
}: {
  event: Event
  comment?: string
  showEmptyFallback: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const trimmed = comment?.trim()

  if (trimmed) {
    return (
      <SuperchatCommentMarkdown event={event} comment={trimmed} className={cn('mt-2', className)} />
    )
  }

  if (!showEmptyFallback) return null

  return (
    <p className={cn('mt-2 text-sm italic text-muted-foreground/75', className)}>
      {t('(No message included.)')}
    </p>
  )
}
