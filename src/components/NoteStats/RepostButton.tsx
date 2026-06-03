import storage from '@/services/local-storage.service'
import { Button } from '@/components/ui/button'
import {
  drawerMenuButtonClassName,
  drawerMenuContentClassName,
  drawerMenuScrollClassName
} from '@/components/DrawerMenuItem'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerOverlay } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { createRepostDraftEvent } from '@/lib/draft-event'
import { getNoteBech32Id } from '@/lib/event'
import { cn } from '@/lib/utils'
import { useNoteStatsRelayHints } from '@/hooks/useNoteStatsRelayHints'
import { useSignGatedControl } from '@/hooks/useSignGatedControl'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import noteStatsService from '@/services/note-stats.service'
import {
  displayListCountWithArchives,
  noteStatsHasResolvableCounts,
  type TNoteStats
} from '@/services/note-stats.service'
import { PencilLine, Repeat } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logger from '@/lib/logger'
import PostEditor from '../PostEditor'
import { BoostCountHover } from './NoteStatsCountHover'
import { formatCount } from './utils'
import { showPublishingFeedback, showSimplePublishSuccess } from '@/lib/publishing-feedback'

type RepostButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<TNoteStats>
}

export function RepostButtonWithStats({ event, hideCount = false, noteStats }: RepostButtonProps) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const { publish, checkLogin, pubkey } = useNostr()
  const { canSignEvents, signControlProps } = useSignGatedControl()
  const { relays: statsRelays } = useNoteStatsRelayHints()
  const [reposting, setReposting] = useState(false)
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const statsLoaded = noteStatsHasResolvableCounts(noteStats)
  const { repostCount, hasReposted } = useMemo(() => {
    return {
      repostCount: displayListCountWithArchives(
        noteStats?.reposts?.length,
        noteStats?.archivesInteractions,
        'reposts'
      ),
      hasReposted: pubkey ? noteStats?.repostPubkeySet?.has(pubkey) : false
    }
  }, [noteStats, event.id, pubkey])
  const showRepostCount = !hideCount && (statsLoaded || (repostCount ?? 0) > 0)
  const canRepost = canSignEvents && !hasReposted && !reposting

  const repost = async () => {
    checkLogin(async () => {
      if (!canRepost) return

      setReposting(true)
      const timer = setTimeout(() => setReposting(false), 5000)

      try {
        const hasReposted = pubkey ? noteStats?.repostPubkeySet?.has(pubkey) : false
        if (hasReposted) return
        if (!noteStats?.updatedAt) {
          await noteStatsService.fetchNoteStats(event, pubkey, statsRelays, { foreground: true })
          // Note: fetchNoteStats doesn't return the stats, it updates them asynchronously
          // The updated stats will be available through the useNoteStatsById hook
        }

        const repost = createRepostDraftEvent(event)
        const evt = await publish(repost, {
          addClientTag: storage.getAddClientTag()
        })
        
        // Show publishing feedback
        if ((evt as any)?.relayStatuses) {
          showPublishingFeedback({
            success: true,
            relayStatuses: (evt as any).relayStatuses,
            successCount: (evt as any).relayStatuses.filter((s: any) => s.success).length,
            totalCount: (evt as any).relayStatuses.length
          }, {
            message: t('Boost published'),
            duration: 4000
          })
        } else {
          showSimplePublishSuccess(t('Boost published'))
        }
        
        noteStatsService.updateNoteStatsByEvents([evt], undefined, {
          interactionTargetNoteId: event.id
        })
      } catch (error) {
        logger.error('Boost failed', { error, eventId: event.id })
      } finally {
        setReposting(false)
        clearTimeout(timer)
      }
    })
  }

  const iconButton = (
    <button
      type="button"
      className={cn(
        'flex h-full items-center enabled:hover:text-lime-500 px-2 touch-manipulation',
        hasReposted ? 'text-lime-500' : 'text-muted-foreground'
      )}
      {...signControlProps({ title: t('Boost'), disabled: !canSignEvents })}
      onClick={() => {
        if (!canSignEvents) return
        if (isSmallScreen) {
          setIsDrawerOpen(true)
        }
      }}
    >
      {reposting ? <Skeleton className="size-5 shrink-0 rounded-full" aria-hidden /> : <Repeat />}
    </button>
  )

  const countLabel = showRepostCount ? (
    <BoostCountHover noteStats={noteStats}>
      <div className="pr-1 text-sm tabular-nums">{formatCount(repostCount ?? 0)}</div>
    </BoostCountHover>
  ) : (
    <span className="pr-1" aria-hidden />
  )

  const postEditor = (
    <PostEditor
      open={isPostDialogOpen}
      setOpen={setIsPostDialogOpen}
      defaultContent={'\nnostr:' + getNoteBech32Id(event)}
    />
  )

  if (isSmallScreen) {
    return (
      <>
        <div className="flex h-full min-w-0 items-center">
          {iconButton}
          {countLabel}
        </div>
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerOverlay onClick={() => setIsDrawerOpen(false)} />
          <DrawerContent hideOverlay className={drawerMenuContentClassName}>
            <DrawerHeader className="sr-only">
              <DrawerTitle>{t('Boost')}</DrawerTitle>
            </DrawerHeader>
            <div className={drawerMenuScrollClassName}>
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsDrawerOpen(false)
                  repost()
                }}
                disabled={!canRepost}
                className={drawerMenuButtonClassName}
                variant="ghost"
              >
                <Repeat />
                <span className="min-w-0 flex-1 text-left">{t('Boost')}</span>
              </Button>
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsDrawerOpen(false)
                  checkLogin(() => {
                    setIsPostDialogOpen(true)
                  })
                }}
                {...signControlProps()}
                className={drawerMenuButtonClassName}
                variant="ghost"
              >
                <PencilLine />
                <span className="min-w-0 flex-1 text-left">{t('Quote')}</span>
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
        {postEditor}
      </>
    )
  }

  return (
    <>
      <div className="flex h-full min-w-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{iconButton}</DropdownMenuTrigger>
          <DropdownMenuContent>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              repost()
            }}
            disabled={!canRepost}
          >
            <Repeat /> {t('Boost')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              checkLogin(() => {
                setIsPostDialogOpen(true)
              })
            }}
            disabled={!canSignEvents}
          >
            <PencilLine /> {t('Quote')}
          </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {countLabel}
      </div>
      {postEditor}
    </>
  )
}

export default function RepostButton({ event, hideCount = false }: RepostButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  return <RepostButtonWithStats event={event} hideCount={hideCount} noteStats={noteStats} />
}
