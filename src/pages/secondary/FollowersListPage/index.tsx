import JsonViewDialog from '@/components/JsonViewDialog'
import ProfileList from '@/components/ProfileList'
import { RefreshButton } from '@/components/RefreshButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useFetchProfile } from '@/hooks'
import { useNostrArchivesAvailable } from '@/hooks/useNostrArchivesAvailable'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import nostrArchivesApi from '@/services/nostr-archives-api.service'
import { Code, MoreVertical } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const FOLLOWERS_PAGE_SIZE = 100

function normalizeFollowerPubkey(pk: string): string | null {
  const trimmed = pk.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null
}

const FollowersListPage = forwardRef(
  ({ id, index, hideTitlebar = false }: { id?: string; index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const archivesAvailable = useNostrArchivesAvailable()
    const [listRefreshNonce, setListRefreshNonce] = useState(0)
    const { profile } = useFetchProfile(id)
    const [followers, setFollowers] = useState<string[]>([])
    const [totalCount, setTotalCount] = useState<number | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
    const [jsonOpen, setJsonOpen] = useState(false)
    const [followersJsonPayload, setFollowersJsonPayload] = useState<unknown>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const loadMoreInFlight = useRef(false)
    const offsetRef = useRef(0)

    const bumpList = useCallback(() => {
      offsetRef.current = 0
      setListRefreshNonce((n) => n + 1)
    }, [])

    const openFollowersJson = useCallback(() => {
      setFollowersJsonPayload({
        pubkey: profile?.pubkey ?? null,
        source: 'nostr-archives',
        endpoint: '/v1/social/{pubkey}',
        followersOffset: offsetRef.current,
        followersLimit: FOLLOWERS_PAGE_SIZE,
        derivedFollowerPubkeys: followers,
        totalCount
      })
      setJsonOpen(true)
    }, [profile?.pubkey, followers, totalCount])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(bumpList)
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, bumpList])

    const fetchPage = useCallback(
      async (offset: number, append: boolean) => {
        const pk = profile?.pubkey
        if (!pk || !archivesAvailable) return false

        const res = await nostrArchivesApi.getSocialGraph(pk, {
          followsLimit: 0,
          followersLimit: FOLLOWERS_PAGE_SIZE,
          followersOffset: offset
        })
        if (!res.ok) return false

        const batch = res.data.followers.pubkeys
          .map(normalizeFollowerPubkey)
          .filter((x): x is string => x != null)

        setTotalCount(res.data.followers.count)
        setFollowers((prev) => {
          if (!append) return batch
          const seen = new Set(prev)
          const out = [...prev]
          for (const p of batch) {
            if (!seen.has(p)) {
              seen.add(p)
              out.push(p)
            }
          }
          return out
        })
        offsetRef.current = offset + batch.length
        setHasMore(offsetRef.current < res.data.followers.count && batch.length > 0)
        return true
      },
      [profile?.pubkey, archivesAvailable]
    )

    useEffect(() => {
      let cancelled = false
      const pk = profile?.pubkey

      if (!pk) {
        setFollowers([])
        setTotalCount(null)
        setHasMore(false)
        setPhase('idle')
        return
      }

      if (!archivesAvailable) {
        setFollowers([])
        setTotalCount(null)
        setHasMore(false)
        setPhase('unavailable')
        return
      }

      setPhase('loading')
      setFollowers([])
      offsetRef.current = 0

      void fetchPage(0, false).then((ok) => {
        if (cancelled) return
        setPhase(ok ? 'ready' : 'unavailable')
      })

      return () => {
        cancelled = true
      }
    }, [profile?.pubkey, listRefreshNonce, archivesAvailable, fetchPage])

    useEffect(() => {
      const el = bottomRef.current
      if (!el || !hasMore || phase !== 'ready') return

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting || loadMoreInFlight.current) return
          loadMoreInFlight.current = true
          void fetchPage(offsetRef.current, true).finally(() => {
            loadMoreInFlight.current = false
          })
        },
        { root: null, rootMargin: '120px', threshold: 0 }
      )
      observer.observe(el)
      return () => observer.disconnect()
    }, [hasMore, phase, fetchPage, followers.length])

    const title =
      hideTitlebar
        ? undefined
        : profile?.username
          ? t("username's followers", { username: profile.username })
          : t('Followers')

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={title}
        hideBackButton={hideTitlebar}
        controls={
          hideTitlebar ? undefined : (
            <div className="flex items-center gap-0">
              <RefreshButton onClick={bumpList} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('More options')}>
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openFollowersJson()}>
                    <Code className="size-4 mr-2" />
                    {t('View JSON')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
        displayScrollToTopButton
      >
        <JsonViewDialog value={followersJsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
        {phase === 'unavailable' ? (
          <p className="text-sm text-muted-foreground">{t('Followers list unavailable')}</p>
        ) : phase === 'loading' && followers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('loading...')}</p>
        ) : followers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No followers found')}</p>
        ) : (
          <>
            {totalCount != null ? (
              <p className="text-xs text-muted-foreground mb-3">{t('Nostr Archives followers hint')}</p>
            ) : null}
            <ProfileList pubkeys={followers} />
          </>
        )}
        <div ref={bottomRef} className="h-1" />
      </SecondaryPageLayout>
    )
  }
)
FollowersListPage.displayName = 'FollowersListPage'
export default FollowersListPage
