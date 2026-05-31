import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import type { TNoteStats } from '@/services/note-stats.service'
import { MessageCircle } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostEditor from '../PostEditor'
import { formatCount } from './utils'

type ReplyButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<TNoteStats>
}

export function ReplyButtonWithStats({ event, hideCount = false, noteStats }: ReplyButtonProps) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const { replyCount, hasReplied } = useMemo(() => {
    const hasReplied = pubkey
      ? noteStats?.replies?.some((reply) => reply.pubkey === pubkey)
      : false

    return {
      replyCount: noteStats?.replies?.length ?? 0,
      hasReplied
    }
  }, [noteStats, event.id, pubkey])
  const statsLoaded = noteStats?.updatedAt != null
  const replyCountLabel = statsLoaded
    ? replyCount >= 100
      ? '99+'
      : String(replyCount)
    : formatCount(replyCount)
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className={cn(
          'flex gap-1.5 items-center enabled:hover:text-blue-400 px-2 h-full min-h-11 touch-manipulation',
          hasReplied ? 'text-blue-400' : 'text-muted-foreground'
        )}
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
        title={t('Reply')}
      >
        <MessageCircle />
        {!hideCount && replyCountLabel !== '' && (
          <div className="text-sm tabular-nums">{replyCountLabel}</div>
        )}
      </button>
      <PostEditor parentEvent={event} open={open} setOpen={setOpen} />
    </>
  )
}

export default function ReplyButton({ event, hideCount = false }: ReplyButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  return <ReplyButtonWithStats event={event} hideCount={hideCount} noteStats={noteStats} />
}
