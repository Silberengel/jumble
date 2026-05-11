import { RefreshButton } from '@/components/RefreshButton'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useSecondaryPage } from '@/contexts/secondary-page-context'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { useFetchProfile } from '@/hooks/useFetchProfile'
import {
  buildInteractionPartnerStats,
  INTERACTION_MAP_RECENCY_MAX_AGE_SEC,
  mergeEventsById,
  mergeInteractionPartnersWithFollowings,
  rankInteractionMapGridRows,
  type TInteractionPartnerStat
} from '@/lib/profile-interaction-partners'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { toProfile } from '@/lib/link'
import { useFollowListOptional } from '@/providers/follow-list-context'
import { useNostr } from '@/providers/NostrProvider'
import { eventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { kinds } from 'nostr-tools'
import type { TPageRef } from '@/types'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const INTERACTION_KINDS = [kinds.ShortTextNote, kinds.Repost, kinds.Reaction] as const

/** Co-located with this lazy page so dev/build chunks share one `react` instance (avoids invalid hook call). */
function useProfileInteractionPartners(authorPubkey: string | undefined, refreshNonce = 0) {
  const [partners, setPartners] = useState<TInteractionPartnerStat[]>([])
  const [loading, setLoading] = useState(false)
  const [archiveAuthorEvents, setArchiveAuthorEvents] = useState(0)
  const [sessionEventCount, setSessionEventCount] = useState(0)

  const run = useCallback(async () => {
    const pk = authorPubkey?.trim().toLowerCase()
    if (!pk || !/^[0-9a-f]{64}$/.test(pk)) {
      setPartners([])
      setArchiveAuthorEvents(0)
      setSessionEventCount(0)
      return
    }
    setLoading(true)
    try {
      const kindsArr = [...INTERACTION_KINDS]
      const sessionEv = eventService.listSessionEventsAuthoredBy(pk, { kinds: kindsArr, limit: 900 })
      setSessionEventCount(sessionEv.length)
      setArchiveAuthorEvents(0)
      const mergedSession = mergeEventsById([...sessionEv])
      setPartners(buildInteractionPartnerStats(mergedSession, pk))

      void (async () => {
        try {
          const idbEv = await indexedDb.scanEventArchiveByAuthorPubkey(pk, {
            kinds: kindsArr,
            maxRowsScanned: 14_000,
            maxMatches: 450
          })
          setArchiveAuthorEvents(idbEv.length)
          const merged = mergeEventsById([...sessionEv, ...idbEv])
          setPartners(buildInteractionPartnerStats(merged, pk))
        } catch {
          /* best-effort disk */
        }
      })()
    } finally {
      setLoading(false)
    }
  }, [authorPubkey])

  useEffect(() => {
    void run()
  }, [run, refreshNonce])

  return { partners, loading, rescan: run, archiveAuthorEvents, sessionEventCount }
}

const ProfileInteractionDiagramPage = forwardRef<
  TPageRef,
  { id?: string; index?: number; hideTitlebar?: boolean }
>(({ id, index, hideTitlebar = false }, ref) => {
  const { t } = useTranslation()
  const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
  const { push } = useSecondaryPage()
  const { pubkey: accountPubkey, checkLogin } = useNostr()
  const followList = useFollowListOptional()
  const { profile } = useFetchProfile(id)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [includeAllFollows, setIncludeAllFollows] = useState(false)
  const [followBusyPubkey, setFollowBusyPubkey] = useState<string | null>(null)
  const bump = useCallback(() => setRefreshNonce((n) => n + 1), [])
  const { partners, loading, rescan, archiveAuthorEvents, sessionEventCount } = useProfileInteractionPartners(
    profile?.pubkey,
    refreshNonce
  )

  const rankedPartners = useMemo(
    () =>
      rankInteractionMapGridRows(partners, {
        includeAllFollows,
        followings: followList?.followings ?? [],
        nowSec: dayjs().unix(),
        maxAgeSec: INTERACTION_MAP_RECENCY_MAX_AGE_SEC,
        gridCap: 72
      }),
    [partners, includeAllFollows, followList?.followings]
  )

  const includeFollowsBreakdown = useMemo(() => {
    if (!includeAllFollows) return null
    const merged = mergeInteractionPartnersWithFollowings(partners, followList?.followings ?? [])
    const fromTags = merged.filter((p) => p.mentionCount > 0 || p.lastReferencedAt > 0).length
    return {
      total: merged.length,
      fromTags,
      fromFollowsOnly: merged.length - fromTags
    }
  }, [includeAllFollows, partners, followList?.followings])

  const showFollowControls = Boolean(followList && accountPubkey)

  const handleFollowToggle = useCallback(
    (targetPubkey: string, nextChecked: boolean) => {
      if (!followList || !accountPubkey) return
      if (targetPubkey.toLowerCase() === accountPubkey.toLowerCase()) return
      checkLogin(async () => {
        setFollowBusyPubkey(targetPubkey)
        try {
          if (nextChecked) await followList.follow(targetPubkey)
          else await followList.unfollow(targetPubkey)
        } catch (err) {
          toast.error(
            (nextChecked ? t('Follow failed') : t('Unfollow failed')) + ': ' + (err as Error).message
          )
        } finally {
          setFollowBusyPubkey(null)
        }
      })
    },
    [followList, accountPubkey, checkLogin, t]
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <p className="text-sm text-muted-foreground flex-1 min-w-0">{t('interactionMapSubtitle')}</p>
          {showFollowControls ? (
            <div className="flex flex-col gap-1.5 shrink-0 sm:max-w-[min(100%,20rem)] sm:text-right">
              <div className="flex items-center gap-2 sm:justify-end">
                <Label htmlFor="interaction-map-include-follows" className="text-sm font-normal cursor-pointer">
                  {t('interactionMapIncludeFollows')}
                </Label>
                <Switch
                  id="interaction-map-include-follows"
                  checked={includeAllFollows}
                  onCheckedChange={setIncludeAllFollows}
                />
              </div>
              {includeAllFollows ? (
                <>
                  <p className="text-xs text-muted-foreground sm:text-right">{t('interactionMapIncludeFollowsHint')}</p>
                  {includeFollowsBreakdown ? (
                    <p className="text-xs text-muted-foreground sm:text-right tabular-nums">
                      {t('interactionMapIncludeFollowsBreakdown', {
                        total: includeFollowsBreakdown.total,
                        fromTags: includeFollowsBreakdown.fromTags,
                        fromFollowsOnly: includeFollowsBreakdown.fromFollowsOnly
                      })}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
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
        ) : rankedPartners.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">{t('interactionMapEmpty')}</div>
        ) : (
          <div
            className={
              includeAllFollows
                ? 'max-h-[min(70vh,720px)] overflow-y-auto overscroll-contain pr-1 -mr-1'
                : undefined
            }
          >
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {rankedPartners.map(({ stat: p, score }) => {
              const heat = score / 100
              const bgAlpha = 0.12 + heat * 0.55
              const borderAlpha = 0.25 + heat * 0.65
              const scoreRounded = Math.round(score)
              const following = Boolean(
                followList?.followings.some((f) => f.toLowerCase() === p.pubkey.toLowerCase())
              )
              const selfCard = accountPubkey?.toLowerCase() === p.pubkey.toLowerCase()
              const cellTitle =
                p.mentionCount > 0 && p.lastReferencedAt > 0
                  ? `${t('interactionMapScore', { score: scoreRounded })} · ${t('interactionMapCellTitle', {
                      count: p.mentionCount,
                      when: dayjs.unix(p.lastReferencedAt).fromNow()
                    })}`
                  : `${t('interactionMapScore', { score: scoreRounded })} · ${t('interactionMapCellTitleFollowOnly')}`
              return (
                <div
                  key={p.pubkey}
                  className="relative isolate rounded-lg border border-border min-w-0 transition hover:opacity-95"
                  style={{
                    backgroundColor: `hsl(var(--primary) / ${bgAlpha})`,
                    borderColor: `hsl(var(--primary) / ${borderAlpha})`
                  }}
                >
                  {/*
                    Avoid a native <button> filling the card: it can steal hit-testing over the follow
                    checkbox (Radix also uses a button), which shows the global disabled cursor and blocks toggles.
                  */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`w-full min-w-0 flex flex-col items-center gap-1 text-left rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring p-2 ${showFollowControls && !selfCard ? 'pt-7' : ''}`}
                    title={cellTitle}
                    onClick={() => push(toProfile(p.pubkey))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        push(toProfile(p.pubkey))
                      }
                    }}
                  >
                    <UserAvatar userId={p.pubkey} className="h-10 w-10 shrink-0" />
                    <div className="w-full min-w-0 text-center">
                      <Username userId={p.pubkey} className="text-xs truncate block" withoutSkeleton />
                    </div>
                    <div className="text-[10px] font-medium tabular-nums text-primary">
                      {t('interactionMapScore', { score: scoreRounded })}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {t('interactionMapMentionsShort', { count: p.mentionCount })}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate w-full text-center">
                      {p.lastReferencedAt > 0 ? dayjs.unix(p.lastReferencedAt).fromNow() : t('interactionMapRecencyUnknown')}
                    </div>
                  </div>
                  {showFollowControls && !selfCard ? (
                    <label
                      className="absolute top-1.5 right-1.5 z-30 flex cursor-pointer items-center gap-1 rounded border border-border/60 bg-background/95 px-1 py-0.5 shadow-sm backdrop-blur-[2px]"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        id={`interaction-follow-${p.pubkey}`}
                        checked={following}
                        disabled={followBusyPubkey === p.pubkey}
                        aria-label={t('interactionMapFollowingCheckbox')}
                        onCheckedChange={(v) => {
                          if (v === 'indeterminate') return
                          handleFollowToggle(p.pubkey, Boolean(v))
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              )
            })}
            </div>
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
