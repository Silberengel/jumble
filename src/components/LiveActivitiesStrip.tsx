import { LIVE_ACTIVITIES_SLIDE_INTERVAL_MS } from '@/lib/live-activities'
import { toNote } from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSmartNoteNavigation } from '@/PageManager'
import { useLiveActivitiesOptional } from '@/providers/useLiveActivities'
import { useUserPreferencesOptional } from '@/providers/UserPreferencesProvider'
import storage from '@/services/local-storage.service'
import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TPlacement = 'sidebar' | 'mobile'

export default function LiveActivitiesStrip({ placement }: { placement: TPlacement }) {
  const { t } = useTranslation()
  const { navigateToNote } = useSmartNoteNavigation()
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

  // `items` can shrink without a new array identity; `slide` may then be out of range until effects run.
  const displayIndex = items.length === 0 ? 0 : Math.min(slide, items.length - 1)
  const itemAtSlide = items[displayIndex]

  const openLiveNote = useCallback(() => {
    const ev = itemAtSlide?.event
    if (!ev) return
    // Same bech32 as {@link getNoteBech32Id} + pass event so {@link navigationEventStore} / cache match the URL.
    navigateToNote(toNote(ev), ev)
  }, [navigateToNote, itemAtSlide])

  if (!showLiveActivitiesBanner || items.length === 0) {
    return null
  }

  const current = items[displayIndex]
  if (!current) {
    return null
  }

  return (
    <div
      className={cn(
        placement === 'sidebar' &&
          'mb-2 rounded-lg border border-border/80 bg-muted/50 p-2 shadow-sm dark:bg-muted/30',
        placement === 'mobile' && 'w-full shrink-0 border-b border-border/80 bg-muted/50 px-2 py-2 dark:bg-muted/30'
      )}
      role="region"
      aria-label={t('liveActivities.regionLabel')}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:text-xs">
        {t('liveActivities.heading')}
      </div>
      <div
        className={cn(
          'flex min-w-0 gap-1.5 rounded-md',
          placement === 'sidebar' && 'flex-col xl:flex-row xl:items-stretch',
          placement === 'mobile' && 'items-stretch'
        )}
      >
        <button
          type="button"
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
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="size-4 shrink-0" aria-hidden />
        </a>
      </div>
      {items.length > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.address}
              type="button"
              aria-label={t('liveActivities.goToSlide', { n: i + 1 })}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === displayIndex ? 'bg-primary' : 'bg-muted-foreground/40 hover:bg-muted-foreground/60'
              )}
              onClick={(e) => {
                e.preventDefault()
                setSlide(i)
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
