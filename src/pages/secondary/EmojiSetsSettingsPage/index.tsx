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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { appendCuratedReadOnlyRelays } from '@/pages/primary/SpellsPage/fauxSpellFeeds'
import {
  buildEmojiSetTags,
  dedupeEmojiSetEventsByD,
  extractEmojiSetEditorFields,
  labelEmojiSetEvent
} from '@/lib/emoji-set-editor'
import { randomString } from '@/lib/random'
import { showPublishingError } from '@/lib/publishing-feedback'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { usePrimaryNoteView } from '@/contexts/primary-note-view-context'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { createEmojiSetDraftEvent } from '@/lib/draft-event'
import { filterEventsExcludingTombstones } from '@/lib/event'
import logger from '@/lib/logger'
import { TOMBSTONES_UPDATED_EVENT } from '@/lib/tombstone-events'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import customEmojiService from '@/services/custom-emoji.service'
import { queryService, replaceableEventService } from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import dayjs from 'dayjs'
import type { TEmoji } from '@/types'
import type { Event } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import { Eraser, Pencil, Plus, Sticker, Trash2 } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const EMOJI_SET_FETCH_OPTS = {
  eoseTimeout: 2000,
  globalTimeout: 15000,
  firstRelayResultGraceMs: false
} as const

const EmojiSetsSettingsPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { pubkey, account, publish, attemptDelete, checkLogin, relayList, cacheRelayListEvent, userEmojiListEvent, profileEvent } =
      useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [lists, setLists] = useState<Event[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [editing, setEditing] = useState<Event | null>(null)
    const [formD, setFormD] = useState('')
    const [formTitle, setFormTitle] = useState('')
    const [formDescription, setFormDescription] = useState('')
    const [formImage, setFormImage] = useState('')
    const [formEmojis, setFormEmojis] = useState<TEmoji[]>([])
    const [newShortcode, setNewShortcode] = useState('')
    const [newUrl, setNewUrl] = useState('')
    const [deleteTarget, setDeleteTarget] = useState<Event | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [cleanTarget, setCleanTarget] = useState<Event | null>(null)
    const [cleaning, setCleaning] = useState(false)

    const canSignEvents = account != null && account.signerType !== 'npub'

    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()

    const buildReadRelays = useCallback((): string[] => {
      const feedUrls = getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadInboxUrls(relayList, cacheRelayListEvent),
        { userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent) }
      )
      return appendCuratedReadOnlyRelays(feedUrls, blockedRelays)
    }, [favoriteRelays, blockedRelays, relayList, cacheRelayListEvent])

    const loadLists = useCallback(async () => {
      if (!pubkey) {
        setLists([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const urls = buildReadRelays()
        if (!urls.length) {
          setLists([])
          return
        }
        const events = await queryService.fetchEvents(
          urls,
          { authors: [pubkey], kinds: [kinds.Emojisets], limit: 500 },
          EMOJI_SET_FETCH_OPTS
        )
        const tombstones = await indexedDb.getAllTombstones()
        setLists(dedupeEmojiSetEventsByD(filterEventsExcludingTombstones(events, tombstones)))
      } catch (e) {
        logger.warn('[EmojiSetsSettings] Failed to load emoji sets', e)
        toast.error(t('Failed to load emoji sets'))
        setLists([])
      } finally {
        setLoading(false)
      }
    }, [pubkey, buildReadRelays, t])

    useEffect(() => {
      void loadLists()
    }, [loadLists])

    useEffect(() => {
      const onTombstones = () => void loadLists()
      window.addEventListener(TOMBSTONES_UPDATED_EVENT, onTombstones)
      return () => window.removeEventListener(TOMBSTONES_UPDATED_EVENT, onTombstones)
    }, [loadLists])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => void loadLists())
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, loadLists])

    const openNew = () => {
      setEditing(null)
      setFormD(randomString(16))
      setFormTitle('')
      setFormDescription('')
      setFormImage('')
      setFormEmojis([])
      setNewShortcode('')
      setNewUrl('')
      setDialogOpen(true)
    }

    const openEdit = (ev: Event) => {
      const f = extractEmojiSetEditorFields(ev)
      setEditing(ev)
      setFormD(f.d)
      setFormTitle(f.title)
      setFormDescription(f.description)
      setFormImage(f.image)
      setFormEmojis([...f.emojis])
      setNewShortcode('')
      setNewUrl('')
      setDialogOpen(true)
    }

    const closeDialog = () => {
      setDialogOpen(false)
      setEditing(null)
    }

    const addEmojiRow = (e: React.FormEvent) => {
      e.preventDefault()
      const sc = newShortcode.trim().replace(/^:+|:+$/gu, '')
      const url = newUrl.trim()
      if (!sc || !url) return
      setFormEmojis((prev) => [...prev, { shortcode: sc, url }])
      setNewShortcode('')
      setNewUrl('')
    }

    const handleSave = async () => {
      await checkLogin(async () => {
        if (!pubkey) return
        let tags: string[][]
        try {
          tags = buildEmojiSetTags({
            d: formD,
            title: formTitle,
            description: formDescription,
            image: formImage,
            emojis: formEmojis
          })
        } catch (err) {
          toast.error((err as Error).message)
          return
        }

        setSaving(true)
        try {
          let createdAt = dayjs().unix()
          if (editing && createdAt === editing.created_at) {
            await new Promise((r) => setTimeout(r, 1100))
            createdAt = dayjs().unix()
          }
          const draft = createEmojiSetDraftEvent(tags, '', createdAt)
          const published = await publish(draft)
          const ev = published as Event
          try {
            await indexedDb.putReplaceableEvent(ev)
          } catch {
            /* ignore tombstone / IDB */
          }
          void replaceableEventService.updateReplaceableEventCache(ev).catch(() => {})
          await customEmojiService.init(userEmojiListEvent, pubkey, profileEvent, [ev])
          toast.success(t('Emoji set saved'))
          closeDialog()
          await loadLists()
        } catch (e) {
          showPublishingError(e instanceof Error ? e : new Error(String(e)))
        } finally {
          setSaving(false)
        }
      })
    }

    const handleConfirmDelete = async () => {
      if (!deleteTarget) return
      await checkLogin(async () => {
        setDeleting(true)
        try {
          await attemptDelete(deleteTarget)
          toast.success(t('Emoji set deleted'))
          setDeleteTarget(null)
          await loadLists()
          await customEmojiService.init(userEmojiListEvent, pubkey, profileEvent)
        } catch (e) {
          showPublishingError(e instanceof Error ? e : new Error(String(e)))
        } finally {
          setDeleting(false)
        }
      })
    }

    const handleConfirmClean = async () => {
      if (!cleanTarget) return
      await checkLogin(async () => {
        setCleaning(true)
        try {
          const fields = extractEmojiSetEditorFields(cleanTarget)
          let createdAt = dayjs().unix()
          if (createdAt === cleanTarget.created_at) {
            await new Promise((r) => setTimeout(r, 1100))
            createdAt = dayjs().unix()
          }
          const tags = buildEmojiSetTags({ d: fields.d, title: fields.title, description: fields.description, image: fields.image, emojis: [] })
          const draft = createEmojiSetDraftEvent(tags, '', createdAt)
          const published = await publish(draft)
          const ev = published as Event
          try {
            await indexedDb.putReplaceableEvent(ev)
          } catch {
            /* ignore tombstone / IDB */
          }
          void replaceableEventService.updateReplaceableEventCache(ev).catch(() => {})
          await customEmojiService.init(userEmojiListEvent, pubkey, profileEvent, [ev])
          toast.success(t('List cleaned'))
          setCleanTarget(null)
          await loadLists()
        } catch (e) {
          showPublishingError(e instanceof Error ? e : new Error(String(e)))
        } finally {
          setCleaning(false)
        }
      })
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={hideTitlebar ? undefined : t('Emoji sets')}
        hideBackButton={hideTitlebar}
        controls={hideTitlebar ? undefined : <RefreshButton onClick={() => void loadLists()} />}
        displayScrollToTopButton
      >
        <div className="min-w-0 space-y-4 px-4 pb-8 pt-2">
          <p className="text-sm text-muted-foreground leading-relaxed">{t('Emoji sets settings intro')}</p>

          {!pubkey ? (
            <p className="text-sm text-muted-foreground">{t('Login to set')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={openNew} className="gap-2">
                  <Plus className="size-4" />
                  {t('New emoji set')}
                </Button>
              </div>

              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : lists.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('No emoji sets yet')}</p>
              ) : (
                <ul className="space-y-2">
                  {lists.map((ev) => (
                    <li
                      key={extractEmojiSetEditorFields(ev).d}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-3 py-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Sticker className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{labelEmojiSetEvent(ev)}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {extractEmojiSetEditorFields(ev).emojis.length} {t('emoji entries')}
                            <span className="mx-1">·</span>
                            <code className="text-[11px]">d={extractEmojiSetEditorFields(ev).d}</code>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setCleanTarget(ev)}
                          title={t('Clean list')}
                          className="text-destructive hover:text-destructive"
                        >
                          <Eraser className="size-4" />
                          <span className="sr-only">{t('Clean list')}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(ev)}
                          title={t('Edit')}
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">{t('Edit')}</span>
                        </Button>
                        {canSignEvents && ev.pubkey === pubkey ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(ev)}
                            title={t('Delete')}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">{t('Delete')}</span>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
          <DialogContent className="max-h-[min(90dvh,36rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? t('Edit emoji set') : t('New emoji set')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="emoji-set-d">{t('List id (d tag)')}</Label>
                <Input
                  id="emoji-set-d"
                  value={formD}
                  onChange={(e) => setFormD(e.target.value)}
                  disabled={!!editing}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{t('Emoji set d tag hint')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="emoji-set-title">{t('Title')}</Label>
                <Input
                  id="emoji-set-title"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={t('Optional display title')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emoji-set-desc">{t('Description')}</Label>
                <Textarea
                  id="emoji-set-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  placeholder={t('Optional')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="emoji-set-image">{t('Image URL')}</Label>
                <Input
                  id="emoji-set-image"
                  value={formImage}
                  onChange={(e) => setFormImage(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('Emoji pack entries')}</Label>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/80 p-2">
                  {formEmojis.length === 0 ? (
                    <li className="text-sm text-muted-foreground">{t('No emoji entries in pack')}</li>
                  ) : (
                    formEmojis.map((em, idx) => (
                      <li key={`${em.shortcode}-${idx}`} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">
                          <code>:{em.shortcode}:</code>{' '}
                          <span className="text-muted-foreground">{em.url}</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-destructive"
                          onClick={() => setFormEmojis((prev) => prev.filter((_, j) => j !== idx))}
                        >
                          {t('Remove')}
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
                <form onSubmit={addEmojiRow} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={newShortcode}
                      onChange={(e) => setNewShortcode(e.target.value)}
                      placeholder={t('Shortcode')}
                    />
                    <Input
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder={t('Image URL')}
                    />
                  </div>
                  <Button type="submit" variant="secondary">
                    {t('Add')}
                  </Button>
                </form>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeDialog}>
                {t('Cancel')}
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={saving || !formD.trim()}>
                {saving ? t('loading...') : t('Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Delete emoji set?')}</AlertDialogTitle>
              <AlertDialogDescription>{t('Delete emoji set confirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault()
                  void handleConfirmDelete()
                }}
              >
                {deleting ? t('loading...') : t('Delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={!!cleanTarget} onOpenChange={(o) => !o && setCleanTarget(null)}>
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
                  void handleConfirmClean()
                }}
              >
                {cleaning ? t('loading...') : t('Clean list')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SecondaryPageLayout>
    )
  }
)

EmojiSetsSettingsPage.displayName = 'EmojiSetsSettingsPage'
export default EmojiSetsSettingsPage
