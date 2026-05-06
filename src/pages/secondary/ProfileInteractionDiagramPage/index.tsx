import { RefreshButton } from '@/components/RefreshButton'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSecondaryPage } from '@/contexts/secondary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import { useProfileInteractionPartners } from '@/hooks/useProfileInteractionPartners'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toProfile } from '@/lib/link'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TPageRef } from '@/types'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const ProfileInteractionDiagramPage = forwardRef<
  TPageRef,
  { id?: string; index?: number; hideTitlebar?: boolean }
>(({ id, index, hideTitlebar = false }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { push } = useSecondaryPage()
  const { profile } = useFetchProfile(id)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const bump = useCallback(() => setRefreshNonce((n) => n + 1), [])
  const { partners, loading, rescan, archiveAuthorEvents, sessionEventCount } = useProfileInteractionPartners(
    profile?.pubkey,
    refreshNonce
  )

  const layoutRef = useRef<TPageRef>(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToTop: (behavior?: ScrollBehavior) => layoutRef.current?.scrollToTop(behavior),
      refresh: () => {
        void rescan()
        bump()
      }
    }),
    [rescan, bump]
  )

  useEffect(() => {
    if (!hideTitlebar) {
      registerPrimaryPanelRefresh(null)
      return
    }
    registerPrimaryPanelRefresh(() => {
      void rescan()
      bump()
    })
    return () => registerPrimaryPanelRefresh(null)
  }, [hideTitlebar, registerPrimaryPanelRefresh, rescan, bump])

  const nowSec = dayjs().unix()
  const maxCount = partners[0]?.mentionCount ?? 1
  const maxAgeSec = Math.max(1, 180 * 86400)

  return (
    <SecondaryPageLayout
      ref={layoutRef}
      index={index}
      title={hideTitlebar ? undefined : t('interactionMapTitle')}
      hideBackButton={hideTitlebar}
      controls={hideTitlebar ? undefined : <RefreshButton onClick={() => void rescan()} />}
      displayScrollToTopButton
    >
      <div className="px-4 pb-8 space-y-4">
        <p className="text-sm text-muted-foreground">{t('interactionMapSubtitle')}</p>
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          <span>{t('interactionMapSessionNotes', { count: sessionEventCount })}</span>
          <span>{t('interactionMapArchiveNotes', { count: archiveAuthorEvents })}</span>
        </div>

        {loading && partners.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {Array.from({ length: 15 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : partners.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">{t('interactionMapEmpty')}</div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {partners.slice(0, 72).map((p) => {
              const countNorm = Math.min(1, p.mentionCount / maxCount)
              const age = Math.max(0, nowSec - p.lastReferencedAt)
              const recencyNorm = 1 - Math.min(1, age / maxAgeSec)
              const heat = 0.55 * countNorm + 0.45 * recencyNorm
              const bgAlpha = 0.12 + heat * 0.55
              const borderAlpha = 0.25 + heat * 0.65
              return (
                <button
                  key={p.pubkey}
                  type="button"
                  className="rounded-lg border border-border p-2 flex flex-col items-center gap-1 min-w-0 text-left transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    backgroundColor: `hsl(var(--primary) / ${bgAlpha})`,
                    borderColor: `hsl(var(--primary) / ${borderAlpha})`
                  }}
                  onClick={() => push(toProfile(p.pubkey))}
                  title={t('interactionMapCellTitle', {
                    count: p.mentionCount,
                    when: dayjs.unix(p.lastReferencedAt).fromNow()
                  })}
                >
                  <UserAvatar userId={p.pubkey} className="h-10 w-10 shrink-0" />
                  <div className="w-full min-w-0 text-center">
                    <Username userId={p.pubkey} className="text-xs truncate block" withoutSkeleton />
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">×{p.mentionCount}</div>
                  <div className="text-[10px] text-muted-foreground truncate w-full text-center">
                    {dayjs.unix(p.lastReferencedAt).fromNow()}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void rescan()}>
            {t('interactionMapRefresh')}
          </Button>
        </div>
      </div>
    </SecondaryPageLayout>
  )
})

ProfileInteractionDiagramPage.displayName = 'ProfileInteractionDiagramPage'
export default ProfileInteractionDiagramPage
