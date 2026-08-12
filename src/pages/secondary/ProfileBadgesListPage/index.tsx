import JsonViewDialog from '@/components/JsonViewDialog'
import CreateAwardBadgeDialog from '@/components/CreateAwardBadgeDialog'
import UnclaimedBadgeAwards from '@/components/UnclaimedBadgeAwards'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { ExtendedKind } from '@/constants'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createReplaceablePersonalListDraftEvent } from '@/lib/draft-event'
import { extractBadgeDefinitionMedia } from '@/lib/badge-definition-media'
import { parseAddressableCoordinate, parseProfileBadgeEntries } from '@/lib/nip58-profile-badges'
import {
  fetchLegacyProfileBadgesListEvent,
  fetchProfileBadgesListEvent,
  buildClaimedBadgeListSafely,
  profileBadgeEntriesToTags,
  shouldOfferProfileBadgesMigration
} from '@/lib/nip58-profile-badges-list'
import type { ProfileBadgeEntry } from '@/lib/nip58-profile-badges'
import { showPublishingError } from '@/lib/publishing-feedback'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { replaceableEventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import dayjs from 'dayjs'
import { Award, Code, Eraser, MoreVertical, Plus, Trash2 } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NotFoundPage from '../NotFoundPage'

function BadgeEntryRow({
  entry,
  onRemove
}: {
  entry: ProfileBadgeEntry
  onRemove: () => void
}) {
  const [label, setLabel] = useState(entry.definitionCoordinate)
  const [imageUrl, setImageUrl] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    const parsed = parseAddressableCoordinate(entry.definitionCoordinate)
    if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) {
      setLabel(entry.definitionCoordinate)
      return
    }
    void replaceableEventService
      .fetchReplaceableEvent(parsed.pubkey, parsed.kind, parsed.d)
      .then((def) => {
        if (cancelled || !def) return
        const name = def.tags.find((t) => t[0] === 'name')?.[1]?.trim() || parsed.d
        setLabel(name)
        setImageUrl(extractBadgeDefinitionMedia(def).thumb ?? extractBadgeDefinitionMedia(def).image)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entry.definitionCoordinate])

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Award className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{entry.definitionCoordinate}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">e: {entry.awardEventId}</div>
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove">
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

const ProfileBadgesListPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { profile, pubkey, publish, checkLogin } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [listEvent, setListEvent] = useState<Event | null>(null)
    const [legacyListEvent, setLegacyListEvent] = useState<Event | null>(null)
    const [entries, setEntries] = useState<ProfileBadgeEntry[]>([])
    const [newDefinitionA, setNewDefinitionA] = useState('')
    const [newAwardE, setNewAwardE] = useState('')
    const [publishing, setPublishing] = useState(false)
    const [migrating, setMigrating] = useState(false)
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)
    const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
    const [cleaning, setCleaning] = useState(false)
    const [createAwardOpen, setCreateAwardOpen] = useState(false)

    const showMigrate = useMemo(
      () => shouldOfferProfileBadgesMigration(listEvent, legacyListEvent),
      [listEvent, legacyListEvent]
    )

    const loadLists = useCallback(async () => {
      if (!pubkey) {
        setListEvent(null)
        setLegacyListEvent(null)
        setEntries([])
        return
      }
      const relays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      const [current, legacy] = await Promise.all([
        fetchProfileBadgesListEvent(pubkey, relays),
        fetchLegacyProfileBadgesListEvent(pubkey, relays)
      ])
      setListEvent(current ?? null)
      setLegacyListEvent(legacy ?? null)
      const active = current ?? null
      setEntries(parseProfileBadgeEntries(active ?? undefined))
      if (current) {
        try {
          await indexedDb.putReplaceableEvent(current)
        } catch {
          /* ignore */
        }
      }
    }, [pubkey, favoriteRelays, blockedRelays])

    useEffect(() => {
      void loadLists()
    }, [loadLists])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => {
        void loadLists()
      })
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, loadLists])

    const publishEntries = useCallback(
      async (nextEntries: ProfileBadgeEntry[], successMessage: string): Promise<boolean> => {
        if (!pubkey) return false
        setPublishing(true)
        try {
          if (dayjs().unix() === listEvent?.created_at) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
          }
          const relays = await buildAccountListRelayUrlsForMerge({
            accountPubkey: pubkey,
            favoriteRelays: favoriteRelays ?? [],
            blockedRelays
          })
          const draft = createReplaceablePersonalListDraftEvent(
            ExtendedKind.PROFILE_BADGES_LIST,
            profileBadgeEntriesToTags(nextEntries),
            ''
          )
          const published = await publish(draft, { specifiedRelayUrls: relays })
          await indexedDb.putReplaceableEvent(published)
          setListEvent(published)
          setEntries(nextEntries)
          toast.success(successMessage)
          return true
        } catch (e) {
          showPublishingError(e instanceof Error ? e : new Error(String(e)))
          return false
        } finally {
          setPublishing(false)
        }
      },
      [pubkey, listEvent?.created_at, favoriteRelays, blockedRelays, publish]
    )

    const handleClaimBadge = useCallback(
      async (claim: ProfileBadgeEntry): Promise<boolean> => {
        if (!pubkey) return false
        let claimed = false
        await checkLogin(async () => {
          try {
            const { nextEntries, alreadyClaimed } = await buildClaimedBadgeListSafely({
              pubkey,
              localEntries: entries,
              claim,
              favoriteRelays: favoriteRelays ?? [],
              blockedRelays
            })
            if (alreadyClaimed) {
              toast.info(t('Badge already on your list'))
              setEntries(nextEntries)
              claimed = true
              return
            }
            claimed = await publishEntries(nextEntries, t('Badge claimed'))
          } catch (e) {
            showPublishingError(e instanceof Error ? e : new Error(String(e)))
            claimed = false
          }
        })
        return claimed
      },
      [pubkey, checkLogin, entries, favoriteRelays, blockedRelays, publishEntries, t]
    )

    const handleSave = useCallback(() => {
      checkLogin(() => void publishEntries(entries, t('Profile badges list updated')))
    }, [checkLogin, publishEntries, entries, t])

    const handleAddEntry = useCallback(() => {
      const a = newDefinitionA.trim()
      const e = newAwardE.trim()
      if (!a || !e) {
        toast.error(t('Profile badges need both definition (a) and award (e)'))
        return
      }
      if (!/^[0-9a-f]{64}$/i.test(e)) {
        toast.error(t('Award must be a 64-character hex event id'))
        return
      }
      const next: ProfileBadgeEntry[] = [...entries, { definitionCoordinate: a, awardEventId: e.toLowerCase() }]
      setEntries(next)
      setNewDefinitionA('')
      setNewAwardE('')
    }, [newDefinitionA, newAwardE, entries, t])

    const handleRemoveEntry = useCallback((entry: ProfileBadgeEntry) => {
      setEntries((prev) =>
        prev.filter(
          (row) =>
            !(
              row.definitionCoordinate === entry.definitionCoordinate &&
              row.awardEventId === entry.awardEventId
            )
        )
      )
    }, [])

    const handleMigrate = useCallback(() => {
      if (!legacyListEvent || migrating) return
      checkLogin(async () => {
        setMigrating(true)
        try {
          const migrated = parseProfileBadgeEntries(legacyListEvent)
          if (migrated.length === 0) {
            toast.error(t('No badges found in deprecated list'))
            return
          }
          await publishEntries(migrated, t('Migrated profile badges to kind 10008'))
        } finally {
          setMigrating(false)
        }
      })
    }, [legacyListEvent, migrating, checkLogin, publishEntries, t])

    const handleCleanList = useCallback(async () => {
      if (!pubkey || cleaning) return
      setCleaning(true)
      try {
        await publishEntries([], t('List cleaned'))
      } finally {
        setCleaning(false)
        setCleanConfirmOpen(false)
      }
    }, [pubkey, cleaning, publishEntries, t])

    const openJson = useCallback(() => {
      setJsonPayload({
        profileBadgesListKind10008: listEvent ?? null,
        deprecatedKind30008ProfileBadges: legacyListEvent ?? null,
        derivedEntries: entries,
        note: 'NIP-58 profile badges: consecutive `a` (badge definition) and `e` (badge award) tag pairs on kind 10008.'
      })
      setJsonOpen(true)
    }, [listEvent, legacyListEvent, entries])

    if (!profile || !pubkey) {
      return <NotFoundPage />
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Profile badges list')}
        hideBackButton={hideTitlebar}
        controls={
          hideTitlebar ? undefined : (
            <div className="flex items-center gap-0">
              <RefreshButton onClick={() => void loadLists()} />
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

        <div className="space-y-4 px-4 pt-2 pb-8">
          <p className="text-sm text-muted-foreground">{t('Profile badges list intro')}</p>

          <UnclaimedBadgeAwards
            claimedEntries={entries}
            onClaimAndPublish={handleClaimBadge}
            publishing={publishing || migrating}
          />

          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => checkLogin(() => setCreateAwardOpen(true))}
          >
            <Plus className="mr-2 size-4" />
            {t('Create and award badge')}
          </Button>

          <CreateAwardBadgeDialog open={createAwardOpen} onOpenChange={setCreateAwardOpen} />

          {showMigrate && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-2">
              <p className="text-sm">{t('Profile badges migrate hint')}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={migrating || publishing}
                onClick={() => handleMigrate()}
              >
                {migrating ? t('loading...') : t('Migrate from kind 30008')}
              </Button>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">
              {t('No profile badges on your list')}
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <BadgeEntryRow
                  key={`${entry.definitionCoordinate}:${entry.awardEventId}`}
                  entry={entry}
                  onRemove={() => handleRemoveEntry(entry)}
                />
              ))}
            </div>
          )}

          <div className="rounded-lg border border-border p-4 space-y-3">
            <Label className="text-sm font-medium">{t('Add badge')}</Label>
            <div className="space-y-2">
              <Input
                value={newDefinitionA}
                onChange={(e) => setNewDefinitionA(e.target.value)}
                placeholder={t('Badge definition (a tag), e.g. 30009:pubkey:bravery')}
                className="font-mono text-sm"
              />
              <Input
                value={newAwardE}
                onChange={(e) => setNewAwardE(e.target.value)}
                placeholder={t('Badge award event id (e tag)')}
                className="font-mono text-sm"
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleAddEntry}>
              {t('Add to list')}
            </Button>
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={publishing || migrating}
            onClick={handleSave}
          >
            {publishing ? t('Publishing...') : t('Publish profile badges list')}
          </Button>
        </div>
      </SecondaryPageLayout>
    )
  }
)

ProfileBadgesListPage.displayName = 'ProfileBadgesListPage'
export default ProfileBadgesListPage
