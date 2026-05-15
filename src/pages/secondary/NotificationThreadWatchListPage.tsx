import JsonViewDialog from '@/components/JsonViewDialog'
import PersonalListBech32List from '@/components/PersonalListBech32List'
import { RefreshButton } from '@/components/RefreshButton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { ExtendedKind } from '@/constants'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createReplaceablePersonalListDraftEvent } from '@/lib/draft-event'
import { notificationThreadWatchBech32IdsFromListEvent } from '@/lib/personal-list-refs'
import { useNostr } from '@/providers/NostrProvider'
import { useNotificationThreadWatch } from '@/providers/NotificationThreadWatchProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import indexedDb from '@/services/indexed-db.service'
import dayjs from 'dayjs'
import { Code, Eraser, MoreVertical } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NotFoundPage from './NotFoundPage'

type TVariant = 'follow' | 'mute'

type TPageProps = { index?: number; hideTitlebar?: boolean; variant: TVariant }

const NotificationThreadWatchListPageInner = forwardRef<HTMLDivElement, TPageProps>(
  function NotificationThreadWatchListPageInner({ index, hideTitlebar = false, variant }, ref) {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { profile, pubkey, publish } = useNostr()
    const { eventsIFollowListEvent, eventsIMutedListEvent, refreshNotificationThreadListsFromRelays } =
      useNotificationThreadWatch()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)
    const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
    const [cleaning, setCleaning] = useState(false)

    const kind =
      variant === 'follow'
        ? ExtendedKind.EVENTS_I_FOLLOW_NOTIFICATIONS_LIST
        : ExtendedKind.EVENTS_I_MUTED_NOTIFICATIONS_LIST
    const listEvent = variant === 'follow' ? eventsIFollowListEvent : eventsIMutedListEvent
    const listMode = variant === 'follow' ? 'notificationThreadFollow' : 'notificationThreadMute'

    const bech32Ids = useMemo(() => notificationThreadWatchBech32IdsFromListEvent(listEvent), [listEvent])

    const refreshFromRelays = useCallback(async () => {
      await refreshNotificationThreadListsFromRelays()
    }, [refreshNotificationThreadListsFromRelays])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => {
        void refreshFromRelays()
      })
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, refreshFromRelays])

    const openJson = useCallback(() => {
      setJsonPayload({
        listEvent: listEvent ?? null,
        derivedBech32Ids: bech32Ids,
        kind,
        note:
          variant === 'follow'
            ? 'Kind 19130 (Imwald): `e` / `a` tags — threads whose replies appear in your notifications as if you were the OP.'
            : 'Kind 19132 (Imwald): `e` / `a` tags — threads whose reply-style notifications are hidden.'
      })
    }, [listEvent, bech32Ids, kind, variant])

    const handleCleanList = useCallback(async () => {
      if (!pubkey || cleaning) return
      setCleaning(true)
      try {
        if (dayjs().unix() === listEvent?.created_at) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
          accountPubkey: pubkey,
          favoriteRelays: favoriteRelays ?? [],
          blockedRelays
        })
        const draft = createReplaceablePersonalListDraftEvent(kind, [], '')
        const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
        await indexedDb.putReplaceableEvent(published)
        await refreshNotificationThreadListsFromRelays()
        toast.success(t('List cleaned'))
      } catch (e) {
        toast.error(t('Failed to clean list') + ': ' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setCleaning(false)
        setCleanConfirmOpen(false)
      }
    }, [
      pubkey,
      cleaning,
      listEvent?.created_at,
      kind,
      favoriteRelays,
      blockedRelays,
      publish,
      refreshNotificationThreadListsFromRelays,
      t
    ])

    if (!profile || !pubkey) {
      return <NotFoundPage />
    }

    const titleKey =
      variant === 'follow' ? 'Notification thread follow list' : 'Notification thread mute list'
    const emptyKey =
      variant === 'follow'
        ? 'No entries in notification thread follow list'
        : 'No entries in notification thread mute list'

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t(titleKey)}
        hideBackButton={hideTitlebar}
        controls={
          hideTitlebar ? undefined : (
            <div className="flex items-center gap-0">
              <RefreshButton onClick={() => void refreshFromRelays()} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('More options')}>
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openJson()}>
                    <Code className="mr-2 size-4" />
                    {t('View JSON')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setCleanConfirmOpen(true)}
                  >
                    <Eraser className="mr-2 size-4" />
                    {t('Clean list')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
        displayScrollToTopButton
      >
        <JsonViewDialog value={jsonPayload} isOpen={jsonOpen} onClose={() => setJsonOpen(false)} />
        <AlertDialog open={cleanConfirmOpen} onOpenChange={setCleanConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Clean this list?')}</AlertDialogTitle>
              <AlertDialogDescription>{t('Clean list confirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cleaning}>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={cleaning}
                onClick={(e) => {
                  e.preventDefault()
                  void handleCleanList()
                }}
              >
                {cleaning ? t('loading...') : t('Clean list')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div key={listEvent?.id ?? 'none'} className="min-h-[30vh] pt-1">
          {bech32Ids.length === 0 ? (
            <p className="px-4 pt-4 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
          ) : (
            <PersonalListBech32List bech32Ids={bech32Ids} listMode={listMode} />
          )}
        </div>
      </SecondaryPageLayout>
    )
  }
)

export const NotificationThreadFollowListPage = forwardRef<HTMLDivElement, Omit<TPageProps, 'variant'>>(
  function NotificationThreadFollowListPage(props, ref) {
    return <NotificationThreadWatchListPageInner {...props} variant="follow" ref={ref} />
  }
)

export const NotificationThreadMuteListPage = forwardRef<HTMLDivElement, Omit<TPageProps, 'variant'>>(
  function NotificationThreadMuteListPage(props, ref) {
    return <NotificationThreadWatchListPageInner {...props} variant="mute" ref={ref} />
  }
)

NotificationThreadFollowListPage.displayName = 'NotificationThreadFollowListPage'
NotificationThreadMuteListPage.displayName = 'NotificationThreadMuteListPage'
