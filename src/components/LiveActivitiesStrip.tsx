import storage from '@/services/local-storage.service'
import { LIVE_ACTIVITIES_SLIDE_INTERVAL_MS } from '@/lib/live-activities'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartNoteNavigation } from '@/PageManager'
import { useSecondaryPageOptional } from '@/contexts/secondary-page-context'
import { useLiveActivitiesOptional } from '@/providers/useLiveActivities'
import { useUserPreferencesOptional } from '@/providers/UserPreferencesProvider'
import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TPlacement = 'sidebar' | 'mobile'

const SWIPE_MIN_PX = 44
const SWIPE_DOMINANCE_RATIO = 1.2
const SWIPE_NOTE_OPEN_SUPPRESS_MS = 400

export default function LiveActivitiesStrip({ placement }: { placement: TPlacement }) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
  const secondaryPage = useSecondaryPageOptional()
  const userPrefs = useUserPreferencesOptional()
  const showLiveActivitiesBanner =
    userPrefs?.showLiveActivitiesBanner ?? storage.getShowLiveActivitiesBanner()
  const live = useLiveActivitiesOptional()
  const items = live?.items ?? []

  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduceMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const [slide, setSlide] = useState(0)

  useEffect(() => {
    setSlide(0)
  }, [items])

  useEffect(() => {
    if (items.length <= 1 || reduceMotion) return
    const id = window.setInterval(() => {
      setSlide((s) => (s + 1) % items.length)
    }, LIVE_ACTIVITIES_SLIDE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [items.length, reduceMotion])

  useLayoutEffect(() => {
    if (items.length === 0) return
    setSlide((s) => Math.min(s, items.length - 1))
  }, [items.length])

  const swipeHintId = useId()
  const swipeGrabRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const swipeNavAtRef = useRef(0)

  const releasePointerIfCaptured = useCallback((el: HTMLDivElement, pointerId: number) => {
    if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(pointerId)) {
      el.releasePointerCapture(pointerId)
    }
  }, [])

  const onSwipePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (placement !== 'mobile' || items.length <= 1) return
      // Taps on the note button / external link must not capture — capture retargets pointerup
      // away from the button and suppresses its click (note never opens in the secondary panel).
      if ((e.target as HTMLElement).closest('button, a, [role="tab"]')) return
      swipeGrabRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [placement, items.length]
  )

  const onSwipePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (placement !== 'mobile' || items.length <= 1) return
      const grab = swipeGrabRef.current
      swipeGrabRef.current = null
      releasePointerIfCaptured(e.currentTarget, e.pointerId)
      if (!grab || grab.pointerId !== e.pointerId) return
      const dx = e.clientX - grab.x
      const dy = e.clientY - grab.y
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      if (ax < SWIPE_MIN_PX || ax < ay * SWIPE_DOMINANCE_RATIO) return
      swipeNavAtRef.current = Date.now()
      if (dx < 0) {
        setSlide((s) => (s + 1) % items.length)
      } else {
        setSlide((s) => (s - 1 + items.length) % items.length)
      }
    },
    [placement, items.length, releasePointerIfCaptured]
  )

  const onSwipePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      swipeGrabRef.current = null
      releasePointerIfCaptured(e.currentTarget, e.pointerId)
    },
    [releasePointerIfCaptured]
  )

  // `items` can shrink without a new array identity; `slide` may then be out of range until effects run.
  const displayIndex = items.length === 0 ? 0 : Math.min(slide, items.length - 1)
  const itemAtSlide = items[displayIndex]

  const openLiveNote = useCallback(() => {
    if (Date.now() - swipeNavAtRef.current < SWIPE_NOTE_OPEN_SUPPRESS_MS) return
    const ev = itemAtSlide?.event
    if (!ev) return
    // Same bech32 as {@link getNoteBech32Id} + pass event so {@link navigationEventStore} / cache match the URL.
    navigateToNote(toNote(ev), ev)
  }, [navigateToNote, itemAtSlide])

  if (!showLiveActivitiesBanner || items.length === 0 || secondaryPage?.isSidePanelOpen) {
    return null
  }

  const current = items[displayIndex]
  if (!current) {
    return null
  }

  const mobileSwipe = placement === 'mobile' && items.length > 1

  return (
    <div
      className={cn(
        'min-w-0 max-w-full overflow-hidden',
        placement === 'sidebar' &&
          'mb-2 rounded-lg border border-border/80 bg-muted/50 p-2 shadow-sm dark:bg-muted/30',
        placement === 'mobile' && 'w-full shrink-0 border-b border-border/80 bg-muted/50 px-2 py-2 dark:bg-muted/30'
      )}
      role="region"
      aria-label={t('liveActivities.regionLabel')}
      aria-describedby={mobileSwipe ? swipeHintId : undefined}
    >
      {mobileSwipe ? (
        <span id={swipeHintId} className="sr-only">
          {t('liveActivities.swipeToBrowse')}
        </span>
      ) : null}
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:text-xs">
        {t('liveActivities.heading')}
      </div>
      <div
        className={cn(
          'flex min-w-0 gap-1.5 rounded-md',
          placement === 'sidebar' && 'flex-col xl:flex-row xl:items-stretch',
          placement === 'mobile' && 'items-stretch touch-pan-y',
          mobileSwipe && 'cursor-grab active:cursor-grabbing'
        )}
        onPointerDown={mobileSwipe ? onSwipePointerDown : undefined}
        onPointerUp={mobileSwipe ? onSwipePointerUp : undefined}
        onPointerCancel={mobileSwipe ? onSwipePointerCancel : undefined}
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={openLiveNote}
          className={cn(
            'flex min-w-0 flex-1 gap-2 rounded-md text-left transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            placement === 'sidebar' && 'flex-col xl:flex-row xl:items-start',
            placement === 'mobile' && 'items-center'
          )}
          title={t('liveActivities.viewNoteTitle')}
        >
          {current.imageUrl ? (
            <img
              src={current.imageUrl}
              alt=""
              className={cn(
                'shrink-0 rounded object-cover',
                placement === 'sidebar' ? 'h-14 w-full xl:h-12 xl:w-12' : 'h-12 w-12'
              )}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-xs font-medium leading-snug xl:text-sm">{current.title}</div>
            {current.summary ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground xl:text-xs">{current.summary}</p>
            ) : null}
            {current.fromFollowedHost ? (
              <p className="mt-1 text-[10px] text-green-600 dark:text-green-500">{t('liveActivities.fromFollow')}</p>
            ) : null}
          </div>
        </button>
        <a
          href={current.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground',
            placement === 'sidebar' ? 'h-9 w-full xl:h-auto xl:w-9 xl:self-start' : 'h-12 w-10'
          )}
          title={t('liveActivities.openJoinPageTitle')}
          aria-label={t('liveActivities.openJoinPageTitle')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-4 shrink-0" aria-hidden />
        </a>
      </div>
      {items.length > 1 ? (
        placement === 'mobile' ? (
          <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
            {items.map((item, i) => (
              <span
                key={item.address}
                className={cn(
                  'block size-1.5 rounded-full',
                  i === displayIndex ? 'bg-primary' : 'bg-muted-foreground/45'
                )}
              />
            ))}
          </div>
        ) : (
          <div className="mt-2 flex justify-center gap-1.5" role="tablist">
            {items.map((item, i) => (
              <button
                key={item.address}
                type="button"
                role="tab"
                aria-selected={i === displayIndex}
                aria-label={t('liveActivities.goToSlide', { n: i + 1 })}
                className="flex shrink-0 items-center justify-center rounded-full p-0.5 active:opacity-80"
                onClick={(e) => {
                  e.preventDefault()
                  setSlide(i)
                }}
              >
                <span
                  className={cn(
                    'block size-1.5 rounded-full transition-colors',
                    i === displayIndex ? 'bg-primary' : 'bg-muted-foreground/45 hover:bg-muted-foreground/70'
                  )}
                  aria-hidden
                />
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}
