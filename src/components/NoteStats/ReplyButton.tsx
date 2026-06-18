import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { cn } from '@/lib/utils'
import { useSignGatedControl } from '@/hooks/useSignGatedControl'
import { useNostr } from '@/providers/NostrProvider'
import {
  displayListCountWithArchives,
  noteStatsHasResolvableCounts,
  type TNoteStats
} from '@/services/note-stats.service'
import { MessageCircle } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PostEditor from '../PostEditor/LazyPostEditor'
import { preloadPostEditorChunk } from '../PostEditor/preload-post-editor-chunk'
import { preloadComposerPageChunk } from '@/pages/secondary/ComposerPage/ComposerPageRoute'
import { navigateToComposer } from '@/lib/open-composer'
import { useSecondaryPage } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'

type ReplyButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<TNoteStats>
}

export function ReplyButtonWithStats({ event, hideCount = false, noteStats }: ReplyButtonProps) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()
  const { signControlProps } = useSignGatedControl()
  const { replyCount, hasReplied } = useMemo(() => {
    const hasReplied = pubkey
      ? noteStats?.replies?.some((reply) => reply.pubkey === pubkey)
      : false

    return {
      replyCount: displayListCountWithArchives(
        noteStats?.replies?.length,
        noteStats?.archivesInteractions,
        'replies',
        event.id
      ),
      hasReplied
    }
  }, [noteStats, event.id, pubkey])
  const statsLoaded = noteStatsHasResolvableCounts(noteStats)
  const showReplyCount = !hideCount && (statsLoaded || replyCount > 0)
  const replyCountLabel =
    replyCount >= 100 ? '99+' : replyCount > 0 || statsLoaded ? String(replyCount) : ''
  const [open, setOpen] = useState(false)

  const preloadReplyComposer = () => {
    if (isSmallScreen) {
      void preloadComposerPageChunk()
    } else {
      void preloadPostEditorChunk()
    }
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'flex gap-1.5 items-center enabled:hover:text-blue-400 px-2 h-full min-h-11 touch-manipulation',
          hasReplied ? 'text-blue-400' : 'text-muted-foreground'
        )}
        onPointerEnter={preloadReplyComposer}
        onFocus={preloadReplyComposer}
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            if (!navigateToComposer(push, isSmallScreen, { parentEvent: event })) {
              void preloadPostEditorChunk().then(() => setOpen(true))
            }
          })
        }}
        {...signControlProps({ title: t('Reply') })}
      >
        <MessageCircle />
        {!showReplyCount ? null : (
          <div className="text-sm tabular-nums">{replyCountLabel}</div>
        )}
      </button>
      {!isSmallScreen ? (
        <PostEditor parentEvent={event} open={open} setOpen={setOpen} />
      ) : null}
    </>
  )
}

export default function ReplyButton({ event, hideCount = false }: ReplyButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  return <ReplyButtonWithStats event={event} hideCount={hideCount} noteStats={noteStats} />
}
