import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ExtendedKind, NIP71_VIDEO_KINDS, PROFILE_FEED_KINDS } from '@/constants'
import {
  applyFeedGitGroupToggle,
  applyFeedPostsGroupToggle,
  applyFeedRepliesGroupToggle,
  FEED_GIT_GROUP_KINDS,
  FEED_POSTS_GROUP_KINDS,
  FEED_REPLIES_GROUP_KINDS,
  isFeedGitGroupEnabled,
  isFeedPostsGroupEnabled,
  isFeedRepliesGroupEnabled
} from '@/lib/feed-kind-filter'
import { LIVE_ACTIVITY_KINDS } from '@/lib/live-activities'
import { cn } from '@/lib/utils'
import { useKindFilterOrDefaults } from '@/providers/KindFilterProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ListFilter } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const KIND_1 = kinds.ShortTextNote
const KIND_1111 = ExtendedKind.COMMENT

const KIND_FILTER_OPTIONS = [
  { kindGroup: [kinds.LongFormArticle, ExtendedKind.WIKI_ARTICLE, ExtendedKind.NOSTR_SPECIFICATION], label: 'Articles' },
  { kindGroup: [ExtendedKind.POLL], label: 'Polls' },
  { kindGroup: [...NIP71_VIDEO_KINDS], label: 'Video Posts' },
  { kindGroup: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME], label: 'Calendar Events' },
  { kindGroup: [...LIVE_ACTIVITY_KINDS], label: 'Live streams' },
  { kindGroup: [kinds.Repost, ExtendedKind.GENERIC_REPOST], label: 'Boosts' }
]

function buildShowKindsFromOptions(
  baseKinds: number[],
  showKind1OPs: boolean,
  showKind1Replies: boolean,
  showKind1111: boolean
): number[] {
  const rest = baseKinds.filter((k) => k !== KIND_1 && k !== KIND_1111)
  const out = [...rest]
  if (showKind1OPs || showKind1Replies) out.push(KIND_1)
  if (showKind1111) out.push(KIND_1111)
  return out.sort((a, b) => a - b)
}

export default function KindFilter({
  showKinds,
  onShowKindsChange
}: {
  showKinds: number[]
  onShowKindsChange: (kinds: number[]) => void
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const {
    showKinds: savedShowKinds,
    showKind1OPs: savedShowKind1OPs,
    showKind1Replies: savedShowKind1Replies,
    showKind1111: savedShowKind1111,
    feedKindFilterBypass,
    updateShowKinds,
    updateFeedKindFilterBypass
  } = useKindFilterOrDefaults()
  const [open, setOpen] = useState(false)
  const [temporaryShowKinds, setTemporaryShowKinds] = useState(showKinds)
  const [temporaryShowKind1OPs, setTemporaryShowKind1OPs] = useState(savedShowKind1OPs)
  const [temporaryShowKind1Replies, setTemporaryShowKind1Replies] = useState(savedShowKind1Replies)
  const [temporaryShowKind1111, setTemporaryShowKind1111] = useState(savedShowKind1111)
  const [temporarySeeAllEvents, setTemporarySeeAllEvents] = useState(feedKindFilterBypass)
  const [isPersistent, setIsPersistent] = useState(true)
  const isDifferentFromSaved = useMemo(
    () => !isSameKindFilter(showKinds, savedShowKinds),
    [showKinds, savedShowKinds]
  )
  const isTemporaryDifferentFromSaved = useMemo(
    () =>
      !isSameKindFilter(temporaryShowKinds, savedShowKinds) ||
      temporaryShowKind1OPs !== savedShowKind1OPs ||
      temporaryShowKind1Replies !== savedShowKind1Replies ||
      temporaryShowKind1111 !== savedShowKind1111 ||
      temporarySeeAllEvents !== feedKindFilterBypass,
    [
      temporaryShowKinds,
      savedShowKinds,
      temporaryShowKind1OPs,
      temporaryShowKind1Replies,
      temporaryShowKind1111,
      temporarySeeAllEvents,
      savedShowKind1OPs,
      savedShowKind1Replies,
      savedShowKind1111,
      feedKindFilterBypass
    ]
  )

  useEffect(() => {
    if (open) {
      setTemporaryShowKinds(showKinds)
      setTemporaryShowKind1OPs(savedShowKind1OPs)
      setTemporaryShowKind1Replies(savedShowKind1Replies)
      setTemporaryShowKind1111(savedShowKind1111)
      setTemporarySeeAllEvents(feedKindFilterBypass)
      setIsPersistent(true)
    }
  }, [
    open,
    showKinds,
    savedShowKind1OPs,
    savedShowKind1Replies,
    savedShowKind1111,
    feedKindFilterBypass
  ])

  const appliedShowKinds = useMemo(
    () =>
      buildShowKindsFromOptions(
        temporaryShowKinds,
        temporaryShowKind1OPs,
        temporaryShowKind1Replies,
        temporaryShowKind1111
      ),
    [temporaryShowKinds, temporaryShowKind1OPs, temporaryShowKind1Replies, temporaryShowKind1111]
  )
  const canApply = temporarySeeAllEvents || appliedShowKinds.length > 0

  const postsGroupEnabled = isFeedPostsGroupEnabled(temporaryShowKind1OPs, temporaryShowKinds)
  const repliesGroupEnabled = isFeedRepliesGroupEnabled(
    temporaryShowKind1Replies,
    temporaryShowKind1111,
    temporaryShowKinds
  )
  const gitGroupEnabled = isFeedGitGroupEnabled(temporaryShowKinds)

  const handleApply = () => {
    if (!canApply) return

    updateFeedKindFilterBypass(temporarySeeAllEvents, { persist: isPersistent })

    if (temporarySeeAllEvents) {
      setOpen(false)
      onShowKindsChange(showKinds)
      return
    }

    const newShowKinds = appliedShowKinds
    if (!isSameKindFilter(newShowKinds, showKinds)) {
      onShowKindsChange(newShowKinds)
    }
    updateShowKinds(newShowKinds, {
      showKind1OPs: temporaryShowKind1OPs,
      showKind1Replies: temporaryShowKind1Replies,
      showKind1111: temporaryShowKind1111,
      persist: isPersistent
    })
    setOpen(false)
  }

  const trigger = (
    <Button
      variant="ghost"
      size="titlebar-icon"
      aria-label={t('Filter')}
      className={cn(
        'relative h-8 w-fit shrink-0 px-1.5 text-xs focus:text-foreground',
        !isDifferentFromSaved && !feedKindFilterBypass && 'text-muted-foreground',
        feedKindFilterBypass && 'text-amber-600 dark:text-amber-400'
      )}
      onClick={() => {
        if (isSmallScreen) {
          setOpen(true)
        }
      }}
    >
      <ListFilter className="size-3.5 shrink-0" />
      <span className="ml-1 hidden min-[352px]:inline">{t('Filter')}</span>
      {isDifferentFromSaved && (
        <div className="absolute size-1.5 rounded-full bg-primary left-6 top-1.5 ring-1 ring-background" />
      )}
    </Button>
  )

  const content = (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 mb-3">
        <span className="text-sm shrink-0">{t('Use filter')}</span>
        <Switch
          checked={temporarySeeAllEvents}
          onCheckedChange={setTemporarySeeAllEvents}
          aria-label={temporarySeeAllEvents ? t('See all events') : t('Use filter')}
        />
        <span className="text-sm shrink-0 text-right">{t('See all events')}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {temporarySeeAllEvents ? t('See all events hint') : t('Use filter hint')}
      </p>
      <div className={cn('grid grid-cols-1 gap-2 min-[480px]:grid-cols-2', temporarySeeAllEvents && 'pointer-events-none opacity-50')}>
        <div
          className={cn(
            'cursor-pointer grid min-w-0 gap-1.5 rounded-lg border px-4 py-3 text-left',
            postsGroupEnabled ? 'border-primary/60 bg-primary/5' : 'clickable'
          )}
          onClick={() => {
            const next = !postsGroupEnabled
            const { showKinds: nextKinds, showKind1OPs } = applyFeedPostsGroupToggle(
              temporaryShowKinds,
              next
            )
            setTemporaryShowKinds(nextKinds)
            setTemporaryShowKind1OPs(showKind1OPs)
          }}
        >
          <p className="leading-snug font-medium whitespace-normal">{t('Posts')}</p>
          <p className="text-muted-foreground text-xs whitespace-normal break-words">
            {t('Feed filter posts group kinds', {
              kinds: [KIND_1, ...FEED_POSTS_GROUP_KINDS].join(', ')
            })}
          </p>
        </div>
        <div
          className={cn(
            'cursor-pointer grid min-w-0 gap-1.5 rounded-lg border px-4 py-3 text-left',
            repliesGroupEnabled ? 'border-primary/60 bg-primary/5' : 'clickable'
          )}
          onClick={() => {
            const next = !repliesGroupEnabled
            const { showKinds: nextKinds, showKind1Replies, showKind1111 } = applyFeedRepliesGroupToggle(
              temporaryShowKinds,
              next
            )
            setTemporaryShowKinds(nextKinds)
            setTemporaryShowKind1Replies(showKind1Replies)
            setTemporaryShowKind1111(showKind1111)
          }}
        >
          <p className="leading-snug font-medium whitespace-normal">{t('Replies')}</p>
          <p className="text-muted-foreground text-xs whitespace-normal break-words">
            {t('Feed filter replies group kinds', {
              kinds: [KIND_1, KIND_1111, ...FEED_REPLIES_GROUP_KINDS].join(', ')
            })}
          </p>
        </div>
        <div
          className={cn(
            'cursor-pointer grid min-w-0 gap-1.5 rounded-lg border px-4 py-3 text-left',
            gitGroupEnabled ? 'border-primary/60 bg-primary/5' : 'clickable'
          )}
          onClick={() => {
            setTemporaryShowKinds(applyFeedGitGroupToggle(temporaryShowKinds, !gitGroupEnabled))
          }}
        >
          <p className="leading-snug font-medium whitespace-normal">{t('Git')}</p>
          <p className="text-muted-foreground text-xs whitespace-normal break-words">
            {t('Feed filter git group kinds', { kinds: FEED_GIT_GROUP_KINDS.join(', ') })}
          </p>
        </div>
        {KIND_FILTER_OPTIONS.map(({ kindGroup, label }) => {
          /** `some` not `every`: saved kinds may include e.g. only 30311 while the row lists 30311–30313; `every` made the box look off while 30311 still matched the feed. */
          const checked = kindGroup.some((k) => temporaryShowKinds.includes(k))
          return (
            <div
              key={kindGroup.join('-')}
              className={cn(
                'cursor-pointer grid min-w-0 gap-1.5 rounded-lg border px-4 py-3 text-left',
                checked ? 'border-primary/60 bg-primary/5' : 'clickable'
              )}
              onClick={() => {
                if (!checked) {
                  setTemporaryShowKinds((prev) => Array.from(new Set([...prev, ...kindGroup])))
                } else {
                  setTemporaryShowKinds((prev) => prev.filter((k) => !kindGroup.includes(k)))
                }
              }}
            >
              <p className="leading-snug font-medium whitespace-normal">{t(label)}</p>
              <p className="text-muted-foreground text-xs whitespace-normal break-words">kind {kindGroup.join(', ')}</p>
            </div>
          )
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds(
              Array.from(
                new Set([
                  ...PROFILE_FEED_KINDS.filter((k) => k !== KIND_1 && k !== KIND_1111),
                  ...FEED_POSTS_GROUP_KINDS,
                  ...FEED_REPLIES_GROUP_KINDS,
                  ...FEED_GIT_GROUP_KINDS
                ])
              )
            )
            setTemporaryShowKind1OPs(true)
            setTemporaryShowKind1Replies(true)
            setTemporaryShowKind1111(true)
          }}
        >
          {t('Select All')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds([])
            setTemporaryShowKind1OPs(false)
            setTemporaryShowKind1Replies(false)
            setTemporaryShowKind1111(false)
          }}
        >
          {t('Clear All')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setTemporaryShowKinds(savedShowKinds)
            setTemporaryShowKind1OPs(savedShowKind1OPs)
            setTemporaryShowKind1Replies(savedShowKind1Replies)
            setTemporaryShowKind1111(savedShowKind1111)
            setTemporarySeeAllEvents(feedKindFilterBypass)
          }}
          disabled={!isTemporaryDifferentFromSaved}
        >
          {t('Reset')}
        </Button>
      </div>

      <Label className="flex items-center gap-2 cursor-pointer mt-4">
        <Checkbox
          id="persistent-filter"
          checked={isPersistent}
          onCheckedChange={(checked) => setIsPersistent(!!checked)}
        />
        <span className="text-sm">{t('Set as default filter')}</span>
      </Label>

      <Button
        onClick={handleApply}
        className="mt-4 w-full"
        disabled={!canApply}
      >
        {t('Apply')}
      </Button>
    </div>
  )

  if (isSmallScreen) {
    return (
      <>
        {trigger}
        <Drawer handleOnly open={open} onOpenChange={setOpen}>
          <DrawerContent
            dragHandle="vaul"
            className="flex max-h-[90dvh] min-h-0 flex-col overflow-hidden px-4"
          >
            <DrawerHeader className="sr-only">
              <DrawerTitle>Filter</DrawerTitle>
            </DrawerHeader>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 pr-4 [scrollbar-gutter:stable]"
              style={{ touchAction: 'pan-y' }}
            >
              {content}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="flex w-[min(24rem,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0"
        collisionPadding={{ top: 80, bottom: 20, left: 16, right: 16 }}
        side="bottom"
        align="end"
        sideOffset={6}
        sticky="always"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pr-5 [scrollbar-gutter:stable]">{content}</div>
      </PopoverContent>
    </Popover>
  )
}

function isSameKindFilter(a: number[], b: number[]) {
  if (a.length !== b.length) {
    return false
  }
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}
