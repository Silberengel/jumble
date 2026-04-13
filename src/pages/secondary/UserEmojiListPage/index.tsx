import JsonViewDialog from '@/components/JsonViewDialog'
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
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createUserEmojiListDraftEvent } from '@/lib/draft-event'
import {
  isEmojiSetPointerTag,
  normalizeEmojiSetATagValue,
  preservedTagsFromUserEmojiListEvent
} from '@/lib/emoji-set-editor'
import { getEmojisFromEvent } from '@/lib/event-metadata'
import { useNostr } from '@/providers/NostrProvider'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { showPublishingError } from '@/lib/publishing-feedback'
import { fetchLatestReplaceableListEvent } from '@/lib/replaceable-list-latest'
import indexedDb from '@/services/indexed-db.service'
import dayjs from 'dayjs'
import { Code, Eraser, MoreVertical, Trash2 } from 'lucide-react'
import { kinds } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import NotFoundPage from '../NotFoundPage'

function normalizeShortcode(raw: string): string {
  return raw.trim().replace(/^:+|:+$/gu, '')
}

function parseEditorState(ev: Event | null): { inline: { shortcode: string; url: string }[]; aRefs: string[][] } {
  if (!ev) return { inline: [], aRefs: [] }
  return {
    inline: getEmojisFromEvent(ev),
    aRefs: ev.tags.filter((t) => isEmojiSetPointerTag(t)).map((t) => [...t])
  }
}

const UserEmojiListPage = forwardRef(
  ({ index, hideTitlebar = false }: { index?: number; hideTitlebar?: boolean }, ref) => {
    const { t } = useTranslation()
    const { registerPrimaryPanelRefresh } = usePrimaryNoteView()
    const { profile, pubkey, publish, checkLogin, updateUserEmojiListEvent } = useNostr()
    const { favoriteRelays, blockedRelays } = useFavoriteRelays()
    const [listEvent, setListEvent] = useState<Event | null>(null)
    const [inlineEmojis, setInlineEmojis] = useState<{ shortcode: string; url: string }[]>([])
    const [setATags, setSetATags] = useState<string[][]>([])
    const [newShortcode, setNewShortcode] = useState('')
    const [newUrl, setNewUrl] = useState('')
    const [newSetRef, setNewSetRef] = useState('')
    const [publishing, setPublishing] = useState(false)
    const [jsonOpen, setJsonOpen] = useState(false)
    const [jsonPayload, setJsonPayload] = useState<unknown>(null)
    const [cleanConfirmOpen, setCleanConfirmOpen] = useState(false)
    const [cleaning, setCleaning] = useState(false)

    const loadList = useCallback(async () => {
      if (!pubkey) {
        setListEvent(null)
        setInlineEmojis([])
        setSetATags([])
        return
      }
      let cached: Event | null | undefined
      try {
        cached = (await indexedDb.getReplaceableEvent(pubkey, kinds.UserEmojiList)) ?? undefined
      } catch {
        cached = undefined
      }
      const relays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      const fromNet = await fetchLatestReplaceableListEvent(pubkey, kinds.UserEmojiList, relays)
      const best =
        !cached && fromNet
          ? fromNet
          : cached && !fromNet
            ? cached
            : cached && fromNet
              ? fromNet.created_at >= cached.created_at
                ? fromNet
                : cached
              : null
      setListEvent(best ?? null)
      const parsed = parseEditorState(best ?? null)
      setInlineEmojis(parsed.inline)
      setSetATags(parsed.aRefs)
      if (best) {
        try {
          await indexedDb.putReplaceableEvent(best)
        } catch {
          /* ignore */
        }
      }
    }, [pubkey, favoriteRelays, blockedRelays])

    useEffect(() => {
      void loadList()
    }, [loadList])

    useEffect(() => {
      if (!hideTitlebar) {
        registerPrimaryPanelRefresh(null)
        return
      }
      registerPrimaryPanelRefresh(() => {
        void loadList()
      })
      return () => registerPrimaryPanelRefresh(null)
    }, [hideTitlebar, registerPrimaryPanelRefresh, loadList])

    const buildTagsForPublish = useCallback((): string[][] => {
      const preserved = preservedTagsFromUserEmojiListEvent(listEvent)
      const emojiTags = inlineEmojis
        .map((e) => {
          const sc = normalizeShortcode(e.shortcode)
          const url = e.url.trim()
          if (!sc || !url) return null
          return ['emoji', sc, url] as string[]
        })
        .filter((row): row is string[] => row != null)
      return [...preserved, ...emojiTags, ...setATags]
    }, [listEvent, inlineEmojis, setATags])

    const dirty = useMemo(() => {
      const cur = parseEditorState(listEvent)
      const sameInline =
        cur.inline.length === inlineEmojis.length &&
        cur.inline.every(
          (e, i) =>
            normalizeShortcode(e.shortcode) === normalizeShortcode(inlineEmojis[i]?.shortcode ?? '') &&
            e.url.trim() === (inlineEmojis[i]?.url ?? '').trim()
        )
      const key = (rows: string[][]) =>
        [...rows]
          .map((r) => r.slice(0, 3).join('|'))
          .sort()
          .join('\n')
      const sameA = key(cur.aRefs) === key(setATags)
      return !sameInline || !sameA
    }, [listEvent, inlineEmojis, setATags])

    const publishList = async () => {
      await checkLogin(async () => {
        if (!pubkey) return
        setPublishing(true)
        try {
          let createdAt = dayjs().unix()
          if (listEvent && createdAt === listEvent.created_at) {
            await new Promise((r) => setTimeout(r, 1100))
            createdAt = dayjs().unix()
          }
          const tags = buildTagsForPublish()
          const content = listEvent?.content ?? ''
          const draft = createUserEmojiListDraftEvent(tags, content, createdAt)
          const comprehensiveRelays = await buildAccountListRelayUrlsForMerge({
            accountPubkey: pubkey,
            favoriteRelays: favoriteRelays ?? [],
            blockedRelays
          })
          const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
          setListEvent(published as Event)
          await updateUserEmojiListEvent(published as Event)
          const parsed = parseEditorState(published as Event)
          setInlineEmojis(parsed.inline)
          setSetATags(parsed.aRefs)
          toast.success(t('User emoji list saved'))
        } catch (e) {
          showPublishingError(e instanceof Error ? e : new Error(String(e)))
        } finally {
          setPublishing(false)
        }
      })
    }

    const addInlineEmoji = (e: React.FormEvent) => {
      e.preventDefault()
      const sc = normalizeShortcode(newShortcode)
      const url = newUrl.trim()
      if (!sc || !url) {
        toast.error(t('User emoji inline invalid'))
        return
      }
      setInlineEmojis((prev) => [...prev, { shortcode: sc, url }])
      setNewShortcode('')
      setNewUrl('')
    }

    const addSetRef = (e: React.FormEvent) => {
      e.preventDefault()
      const norm = normalizeEmojiSetATagValue(newSetRef)
      if (!norm) {
        toast.error(t('User emoji set ref invalid'))
        return
      }
      const nextTag = ['a', norm]
      const seen = new Set(
        setATags.map((t) => (t[1] ?? '').toLowerCase())
      )
      if (seen.has(norm.toLowerCase())) {
        toast.error(t('User emoji set ref duplicate'))
        return
      }
      setSetATags((prev) => [...prev, nextTag])
      setNewSetRef('')
    }

    const handleCleanList = useCallback(async () => {
      if (!pubkey || cleaning) return
      await checkLogin(async () => {
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
          const preserved = preservedTagsFromUserEmojiListEvent(listEvent)
          let createdAt = dayjs().unix()
          if (listEvent && createdAt === listEvent.created_at) {
            await new Promise((r) => setTimeout(r, 1100))
            createdAt = dayjs().unix()
          }
          const draft = createUserEmojiListDraftEvent(preserved, listEvent?.content ?? '', createdAt)
          const published = await publish(draft, { specifiedRelayUrls: comprehensiveRelays })
          setListEvent(published as Event)
          await updateUserEmojiListEvent(published as Event)
          setInlineEmojis([])
          setSetATags([])
          toast.success(t('List cleaned'))
        } catch (e) {
          toast.error(t('Failed to clean list') + ': ' + (e instanceof Error ? e.message : String(e)))
        } finally {
          setCleaning(false)
          setCleanConfirmOpen(false)
        }
      })
    }, [
      pubkey,
      cleaning,
      listEvent,
      favoriteRelays,
      blockedRelays,
      publish,
      updateUserEmojiListEvent,
      checkLogin,
      t
    ])

    const openJson = useCallback(() => {
      setJsonPayload({
        listEvent: listEvent ?? null,
        editing: { inlineEmojis, setATags },
        note: 'Kind 10030: `emoji` tags (shortcode, URL) and `a` tags pointing at kind 30030 emoji sets.'
      })
      setJsonOpen(true)
    }, [listEvent, inlineEmojis, setATags])

    if (!profile || !pubkey) {
      return <NotFoundPage />
    }

    return (
      <SecondaryPageLayout
        ref={ref}
        index={index}
        title={
          hideTitlebar
            ? undefined
            : t('User emoji list title', {
                username: profile.username,
                defaultValue: `${profile.username}'s emoji list`
              })
        }
        hideBackButton={hideTitlebar}
        controls={
          hideTitlebar ? undefined : (
            <div className="flex items-center gap-0">
              <RefreshButton onClick={() => void loadList()} />
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
                onClick={(ev) => {
                  ev.preventDefault()
                  void handleCleanList()
                }}
              >
                {cleaning ? t('loading...') : t('Clean list')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="min-w-0 space-y-6 px-4 pb-8 pt-2">
          <p className="text-sm text-muted-foreground leading-relaxed">{t('User emoji list intro')}</p>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('User emoji inline section')}</h3>
            <ul className="space-y-2">
              {inlineEmojis.length === 0 ? (
                <li className="text-sm text-muted-foreground">{t('User emoji inline empty')}</li>
              ) : (
                inlineEmojis.map((row, i) => (
                  <li
                    key={`${row.shortcode}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-3 py-2"
                  >
                    <div className="min-w-0">
                      <code className="text-sm">:{row.shortcode}:</code>
                      <div className="truncate text-xs text-muted-foreground">{row.url}</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setInlineEmojis((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={t('Remove')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={addInlineEmoji} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="grid flex-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ue-short">{t('Shortcode')}</Label>
                  <Input
                    id="ue-short"
                    value={newShortcode}
                    onChange={(ev) => setNewShortcode(ev.target.value)}
                    placeholder="chad_yes"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ue-url">{t('Image URL')}</Label>
                  <Input
                    id="ue-url"
                    value={newUrl}
                    onChange={(ev) => setNewUrl(ev.target.value)}
                    placeholder="https://…"
                    autoComplete="off"
                  />
                </div>
              </div>
              <Button type="submit" variant="secondary">
                {t('Add')}
              </Button>
            </form>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('User emoji sets section')}</h3>
            <p className="text-xs text-muted-foreground">{t('User emoji sets hint')}</p>
            <ul className="space-y-2">
              {setATags.length === 0 ? (
                <li className="text-sm text-muted-foreground">{t('User emoji sets empty')}</li>
              ) : (
                setATags.map((tag, i) => (
                  <li
                    key={`${tag[1] ?? i}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-3 py-2"
                  >
                    <code className="break-all text-xs">{tag[1]}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setSetATags((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={t('Remove')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={addSetRef} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="ue-aref">{t('Emoji set coordinate')}</Label>
                <Input
                  id="ue-aref"
                  value={newSetRef}
                  onChange={(ev) => setNewSetRef(ev.target.value)}
                  placeholder="30030:…"
                  className="font-mono text-sm"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" variant="secondary">
                {t('Add')}
              </Button>
            </form>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" disabled={!dirty || publishing} onClick={() => void publishList()}>
              {publishing ? t('loading...') : t('Publish changes')}
            </Button>
          </div>
        </div>
      </SecondaryPageLayout>
    )
  }
)

UserEmojiListPage.displayName = 'UserEmojiListPage'
export default UserEmojiListPage
