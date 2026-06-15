import { Button } from '@/components/ui/button'
import { DialogContext } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserReadInboxUrls } from '@/hooks/useUserMailboxRelayUrls'
import { useNostr } from '@/providers/NostrProvider'
import { ExtendedKind } from '@/constants'
import { cn } from '@/lib/utils'
import {
  cachePublishedGif,
  fetchGifs,
  getAllCachedGifsForSearch,
  getGif1063RelayUrls,
  gifMetadataMatchesSearch,
  gifShouldOfferNip94Archive,
  buildKind1063GifPublishDraft,
  appendGifDescriptionTo1063Tags,
  type GifMetadata
} from '@/services/gif.service'
import mediaUpload from '@/services/media-upload.service'
import { Download, ExternalLink, X } from 'lucide-react'
import { kinds } from 'nostr-tools'
import { Slot } from '@radix-ui/react-slot'
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useFollowListOptional } from '@/providers/follow-list-context'

/** In-session cache: survives Drawer/Dropdown open↔close without a relay re-fetch. */
let _sessionGifs: GifMetadata[] = []
import { useTranslation } from 'react-i18next'

const GIFBUDDY_URL = 'https://www.gifbuddy.lol/'
/** Stable empty follows list — avoids re-running picker fetch every render. */
const EMPTY_FOLLOWING_PUBKEYS: readonly string[] = []
/** Query param gifbuddy may use for pre-filled search (common convention). */
const GIFBUDDY_SEARCH_URL = (q: string) =>
  q.trim() ? `${GIFBUDDY_URL}gifsearch?q=${encodeURIComponent(q.trim())}` : GIFBUDDY_URL

type GifPickerTab = 'find' | 'import'

/** Tall enough to browse the grid; still leaves room above the post composer. */
function mobileDrawerMaxHeightStyle(): CSSProperties {
  const vh = window.visualViewport?.height ?? window.innerHeight
  const maxPx = Math.min(Math.round(vh * 0.88), Math.round(vh - 48))
  return { maxHeight: maxPx, height: maxPx }
}

const MOBILE_GIF_GRID_SCROLL_CLASS =
  'page-scroll-y min-h-0 flex-1 basis-0 overflow-y-scroll overflow-x-hidden overscroll-y-contain touch-pan-y rounded-md border'

const DESKTOP_GIF_GRID_SCROLL_CLASS =
  'h-[min(480px,55dvh)] w-full shrink-0 rounded-md border'

function listFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled'))
}

export default function GifPicker({
  children,
  onSelect,
  portalContainer
}: {
  children: React.ReactNode
  onSelect?: (gifUrl: string) => void
  /** When set (e.g. inside a modal), picker content portals here so it stays on top of the modal */
  portalContainer?: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const inDialog = useContext(DialogContext)
  /** Post composer on desktop: centered portal panel (not dropdown/dialog). */
  const useDialogShell = inDialog && !isSmallScreen
  const { publish, pubkey } = useNostr()
  const followList = useFollowListOptional()
  const followingPubkeys = useMemo(
    () => followList?.followings ?? EMPTY_FOLLOWING_PUBKEYS,
    [followList?.followings]
  )
  const loadGenerationRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  // Initialise from the module-level session cache so re-opens are instant
  const [gifs, setGifsState] = useState<GifMetadata[]>(() => _sessionGifs)
  const gifsRef = useRef<GifMetadata[]>(_sessionGifs)
  const gifPoolRef = useRef<GifMetadata[]>(_sessionGifs)
  const searchInputRef = useRef(searchInput)
  searchInputRef.current = searchInput
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [publishingPaste, setPublishingPaste] = useState(false)
  const [archivingEventId, setArchivingEventId] = useState<string | null>(null)
  const [publishDescription, setPublishDescription] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const gifbuddyPopupRef = useRef<Window | null>(null)
  const pickerRootRef = useRef<HTMLDivElement>(null)
  const composerPanelRef = useRef<HTMLDivElement>(null)
  const searchFieldRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [mobileDrawerStyle, setMobileDrawerStyle] = useState<CSSProperties | undefined>()
  const [activeTab, setActiveTab] = useState<GifPickerTab>('find')
  /** Keep drawer content mounted until Vaul's close animation finishes (avoids empty-sheet flicker). */
  const [drawerContentMounted, setDrawerContentMounted] = useState(false)

  const userReadRelays = useUserReadInboxUrls()

  /** Kind 1063 publish targets — GIF relays only. */
  const gif1063PublishRelayUrls = useMemo(() => getGif1063RelayUrls(), [])

  /** Keep gifsRef, session cache, and React state in sync. */
  const setGifs = useCallback((newGifs: GifMetadata[], isSearch = false) => {
    gifsRef.current = newGifs
    if (!isSearch) _sessionGifs = newGifs
    setGifsState(newGifs)
  }, [])

  /** Apply search filter to the in-memory GIF pool (instant, no network). */
  const applyLocalFilter = useCallback(
    (q: string) => {
      const trimmed = q.trim()
      const pool = gifPoolRef.current
      const filtered = trimmed
        ? pool.filter((g) => gifMetadataMatchesSearch(g, trimmed))
        : pool
      setGifs(filtered, trimmed.length > 0)
    },
    [setGifs]
  )

  const refreshGifPoolFromIdb = useCallback(async () => {
    const pool = await getAllCachedGifsForSearch(pubkey ?? null, followingPubkeys)
    gifPoolRef.current = pool
    return pool
  }, [pubkey, followingPubkeys])

  const loadGifs = useCallback(
    async (forceRefresh = false) => {
      const generation = ++loadGenerationRef.current
      setError(null)
      let cachedCount = gifPoolRef.current.length

      try {
        const cached = await refreshGifPoolFromIdb()
        if (generation !== loadGenerationRef.current) return
        cachedCount = cached.length
        if (cached.length > 0) {
          applyLocalFilter(searchInputRef.current)
        } else if (gifPoolRef.current.length === 0) {
          setLoading(true)
        }
      } catch {
        if (gifPoolRef.current.length === 0) setLoading(true)
      }

      // Sparse IDB (e.g. after a partial relay write) should top up from relays on open.
      const sparseCache = cachedCount > 0 && cachedCount < 10

      try {
        await fetchGifs({
          forceRefresh: forceRefresh || sparseCache,
          userPubkey: pubkey ?? null,
          followingPubkeys,
          noteFallbackRelays: userReadRelays
        })
        if (generation !== loadGenerationRef.current) return
        await refreshGifPoolFromIdb()
        if (generation !== loadGenerationRef.current) return
        applyLocalFilter(searchInputRef.current)
        if (gifPoolRef.current.length === 0 && !searchInputRef.current.trim()) {
          setError(
            t(
              'No GIFs found. Try searching or add your own. GIFs come from Nostr kind 1063 (NIP-94) events on GIF relays.'
            )
          )
        }
      } catch (e) {
        if (generation !== loadGenerationRef.current) return
        setError(e instanceof Error ? e.message : 'Failed to load GIFs')
        if (gifPoolRef.current.length === 0) setGifsState([])
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false)
      }
    },
    [t, userReadRelays, pubkey, followingPubkeys, applyLocalFilter, refreshGifPoolFromIdb]
  )

  useEffect(() => {
    if (!open) return
    applyLocalFilter(searchInput)
  }, [searchInput, open, applyLocalFilter])

  useEffect(() => {
    if (!open) return
    void loadGifs()
  }, [open, loadGifs])

  useEffect(() => {
    if (!open || !isSmallScreen) return
    const syncHeight = () => setMobileDrawerStyle(mobileDrawerMaxHeightStyle())
    syncHeight()
    const vv = window.visualViewport
    vv?.addEventListener('resize', syncHeight)
    window.addEventListener('resize', syncHeight)
    return () => {
      vv?.removeEventListener('resize', syncHeight)
      window.removeEventListener('resize', syncHeight)
    }
  }, [open, isSmallScreen])

  useEffect(() => {
    if (open) setDrawerContentMounted(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveTab('find')
    setSearchInput('')
    applyLocalFilter('')
  }, [open, applyLocalFilter])

  const preparePickerClose = useCallback(() => {
    loadGenerationRef.current += 1
    setLoading(false)
    const el = document.activeElement
    if (el instanceof HTMLElement && pickerRootRef.current?.contains(el)) {
      el.blur()
    }
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next && useDialogShell) {
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      if (!next) {
        preparePickerClose()
        if (useDialogShell) {
          const restore = restoreFocusRef.current
          restoreFocusRef.current = null
          if (restore?.isConnected) {
            requestAnimationFrame(() => restore.focus())
          }
        }
      }
      setOpen(next)
    },
    [preparePickerClose, useDialogShell]
  )

  /** Composer portal: focus search and keep tab cycles inside the picker. */
  useEffect(() => {
    if (!open || !useDialogShell) return

    const focusSearch = () => searchFieldRef.current?.focus({ preventScroll: true })
    let raf = 0
    let timer = 0
    if (activeTab === 'find') {
      raf = requestAnimationFrame(focusSearch)
      timer = window.setTimeout(focusSearch, 0)
    }

    const panel = composerPanelRef.current
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return
      const focusables = listFocusableElements(panel)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, useDialogShell, activeTab])

  /** Escape closes the in-composer panel without dismissing the post editor dialog. */
  useEffect(() => {
    if (!open || !useDialogShell) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      handleOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, useDialogShell, handleOpenChange])

  const handleDrawerAnimationEnd = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      setDrawerContentMounted(false)
      setMobileDrawerStyle(undefined)
    }
  }, [])

  const handleSelect = useCallback(
    (gif: GifMetadata) => {
      const url = (gif.fallbackUrl?.trim() || gif.url).trim()
      if (!url) return
      const desc = publishDescription.trim()
      onSelect?.(url)
      handleOpenChange(false)
      if (!pubkey || !/^https?:\/\//i.test(url)) return
      // Fire-and-forget: waiting on every relay can freeze the UI when relays are down.
      void publish(buildKind1063GifPublishDraft(url, desc), {
        specifiedRelayUrls: gif1063PublishRelayUrls
      })
        .then((event) =>
          cachePublishedGif({
            url,
            mimeType: 'image/gif',
            description: desc || undefined,
            sourceKind: ExtendedKind.FILE_METADATA,
            eventId: event.id,
            pubkey: event.pubkey,
            createdAt: event.created_at
          })
        )
        .catch(() => {})
      if (desc) setPublishDescription('')
    },
    [pubkey, onSelect, publish, gif1063PublishRelayUrls, publishDescription, handleOpenChange]
  )

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pubkey) return
    setUploadError(null)
    setUploading(true)
    try {
      if (!file.type.includes('gif') && !file.name.toLowerCase().endsWith('.gif')) {
        setUploadError(t('{{name}} is not a GIF file', { name: file.name }))
        return
      }
      const { url } = await mediaUpload.upload(file)
      const desc = publishDescription.trim()
      const tags: string[][] = [
        ['file', url, file.type || 'image/gif', `size ${file.size}`],
        ['url', url],
        ['m', file.type || 'image/gif'],
        ['t', 'gif']
      ]
      appendGifDescriptionTo1063Tags(tags, desc)
      const draft = {
        kind: ExtendedKind.FILE_METADATA,
        content: desc,
        tags,
        created_at: Math.floor(Date.now() / 1000)
      }
      const published = await publish(draft, { specifiedRelayUrls: gif1063PublishRelayUrls })
      await cachePublishedGif({
        url,
        mimeType: file.type || 'image/gif',
        description: desc || undefined,
        sourceKind: ExtendedKind.FILE_METADATA,
        eventId: published.id,
        pubkey: published.pubkey,
        createdAt: published.created_at
      })
      setPublishDescription('')
      setSearchInput('')
      await loadGifs(true)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const triggerFileUpload = () => fileInputRef.current?.click()

  const isLoggedIn = !!pubkey

  /** Open GifBuddy in a new tab (not a popup) so the picker doesn't close from focus loss. Listen for postMessage in case GifBuddy adds embed support. */
  const openGifBuddySearch = useCallback(() => {
    const url = GIFBUDDY_SEARCH_URL(pasteUrl || searchInput)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    gifbuddyPopupRef.current = w ?? null
    const handler = (event: MessageEvent) => {
      if (event.origin !== 'https://www.gifbuddy.lol' && event.origin !== 'https://gifbuddy.lol') return
      const data = event.data
      const urlToInsert =
        typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))
          ? data
          : data?.url ?? data?.gifUrl
      if (urlToInsert && typeof urlToInsert === 'string') {
        window.removeEventListener('message', handler)
        gifbuddyPopupRef.current = null
        onSelect?.(urlToInsert)
        handleOpenChange(false)
      }
    }
    window.addEventListener('message', handler)
    const t = setTimeout(() => {
      window.removeEventListener('message', handler)
      gifbuddyPopupRef.current = null
    }, 10 * 60 * 1000)
    if (w) w.addEventListener('beforeunload', () => { clearTimeout(t); window.removeEventListener('message', handler) })
  }, [pasteUrl, searchInput, onSelect, handleOpenChange])

  const descriptionForPublish = publishDescription.trim()

  /** Insert pasted GIF URL and publish kind 1063 so it's added to Nostr GIF library. */
  const handlePasteUrlInsert = useCallback(async () => {
    const url = pasteUrl.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    onSelect?.(url)
    setPasteUrl('')
    handleOpenChange(false)
    if (pubkey) {
      setPublishingPaste(true)
      try {
        const published = await publish(buildKind1063GifPublishDraft(url, descriptionForPublish), {
          specifiedRelayUrls: gif1063PublishRelayUrls
        })
        await cachePublishedGif({
          url,
          mimeType: 'image/gif',
          description: descriptionForPublish || undefined,
          sourceKind: ExtendedKind.FILE_METADATA,
          eventId: published.id,
          pubkey: published.pubkey,
          createdAt: published.created_at
        })
        setPublishDescription('')
      } catch {
        // ignore; URL was still inserted
      } finally {
        setPublishingPaste(false)
      }
    }
  }, [pasteUrl, pubkey, onSelect, publish, gif1063PublishRelayUrls, descriptionForPublish, handleOpenChange])

  /** External GIF from a note: publish kind 1063, then insert URL and close (same relays as grid pick). */
  const handleArchiveAndInsert = useCallback(
    (e: React.MouseEvent, gif: GifMetadata) => {
      e.preventDefault()
      e.stopPropagation()
      if (!pubkey) return
      const url = (gif.fallbackUrl?.trim() || gif.url).trim()
      if (!url || !/^https?:\/\//i.test(url)) return
      const desc = publishDescription.trim()
      setArchivingEventId(gif.eventId)
      onSelect?.(url)
      handleOpenChange(false)
      void loadGifs(true)
      void publish(buildKind1063GifPublishDraft(url, desc), {
        specifiedRelayUrls: gif1063PublishRelayUrls
      })
        .catch(() => {})
        .finally(() => {
          setArchivingEventId(null)
          if (desc) setPublishDescription('')
        })
    },
    [pubkey, publish, gif1063PublishRelayUrls, onSelect, loadGifs, publishDescription, handleOpenChange]
  )

  const gifSourceKindTitle = useCallback(
    (gif: GifMetadata) => {
      if (gif.sourceKind === ExtendedKind.FILE_METADATA) {
        return t(
          'This GIF comes from kind 1063 (NIP-94 file metadata). Choosing it still publishes your own kind 1063 to your write relays (and fast write relays as fallback) so your relays index the URL.'
        )
      }
      if (gif.sourceKind === kinds.ShortTextNote) {
        return t(
          'This GIF was found in a kind 1 note. Notes are not NIP-94 GIF index entries; publish kind 1063 yourself if you want it discoverable as file metadata.'
        )
      }
      if (gif.sourceKind === ExtendedKind.COMMENT) {
        return t(
          'This GIF was found in a kind 1111 comment. Comments are not NIP-94 GIF index entries; publish kind 1063 yourself if you want it discoverable as file metadata.'
        )
      }
      return t('This GIF was found in a Nostr event of kind {{kind}}.', { kind: gif.sourceKind })
    },
    [t]
  )

  const gifSourceKindShortLabel = (gif: GifMetadata) => {
    if (gif.sourceKind === ExtendedKind.FILE_METADATA) return '1063'
    if (gif.sourceKind === kinds.ShortTextNote) return '1'
    if (gif.sourceKind === ExtendedKind.COMMENT) return '1111'
    return String(gif.sourceKind)
  }

  /** In drawer mode we constrain height and make only the GIF grid scroll so the drawer doesn't "sink" */
  const isDrawer = isSmallScreen
  const renderGifGrid = (items: GifMetadata[], showArchiveActions: boolean) =>
    loading ? (
      <div
        className="grid grid-cols-2 gap-1 p-2 min-h-[120px]"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full rounded" />
        ))}
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-1 p-2 min-h-[120px] content-start">
        {items.map((gif) => {
          const showArchive = showArchiveActions && gifShouldOfferNip94Archive(gif) && isLoggedIn
          return (
            <div
              key={gif.eventId}
              className="relative aspect-square min-h-0 w-full rounded overflow-hidden [contain:layout]"
            >
              <button
                type="button"
                className={cn(
                  'absolute inset-0 z-0 touch-manipulation rounded overflow-hidden border border-transparent hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80'
                )}
                onClick={() => handleSelect(gif)}
              >
                <img
                  src={gif.url}
                  alt=""
                  className="w-full h-full object-cover pointer-events-none"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement
                    const fallback = gif.fallbackUrl?.trim()
                    if (fallback && el.dataset.gifFallbackTried !== '1') {
                      el.dataset.gifFallbackTried = '1'
                      el.src = fallback
                      return
                    }
                    el.style.display = 'none'
                  }}
                />
              </button>
              <span
                className="absolute top-1 left-1 z-10 max-w-[calc(100%-2.5rem)] truncate rounded border border-border/80 bg-background/90 px-1 py-px text-[10px] font-medium tabular-nums text-foreground backdrop-blur-sm pointer-events-none shadow-sm"
                title={gifSourceKindTitle(gif)}
              >
                {gifSourceKindShortLabel(gif)}
              </span>
              {showArchive && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute bottom-1 right-1 z-10 h-7 w-7 shadow-md touch-manipulation"
                  disabled={archivingEventId === gif.eventId}
                  title={t(
                    'Publish kind 1063 (NIP-94) for this GIF and insert the URL into your post'
                  )}
                  aria-label={t(
                    'Publish kind 1063 (NIP-94) for this GIF and insert the URL into your post'
                  )}
                  onClick={(e) => handleArchiveAndInsert(e, gif)}
                >
                  <Download className="size-3.5" />
                </Button>
              )}
            </div>
          )
        })}
      </div>
    )

  const scrollableGifGrid = (items: GifMetadata[], showArchiveActions: boolean) =>
    isDrawer ? (
      <div className={MOBILE_GIF_GRID_SCROLL_CLASS} data-vaul-no-drag>
        {renderGifGrid(items, showArchiveActions)}
      </div>
    ) : (
      <ScrollArea className={DESKTOP_GIF_GRID_SCROLL_CLASS} scrollBarClassName="opacity-100">
        {renderGifGrid(items, showArchiveActions)}
      </ScrollArea>
    )

  const findPanel = (
    <div className={cn('flex flex-col gap-2', isDrawer && 'min-h-0 flex-1 basis-0')}>
      {!isDrawer ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          {t('Search your library and tap a GIF to insert.')}
        </p>
      ) : null}
      <Input
        ref={searchFieldRef}
        placeholder={t('Search GIFs')}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="shrink-0"
      />
      {!loading && gifs.length > 0 ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          {t('{{count}} GIFs', { count: gifs.length, defaultValue: '{{count}} GIFs' })}
        </p>
      ) : null}
      {error && <p className="shrink-0 px-1 text-sm text-muted-foreground">{error}</p>}
      {scrollableGifGrid(gifs, !isDrawer)}
    </div>
  )

  const importPanel = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('Paste a GIF URL, upload your own file, or search GifBuddy.')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full touch-manipulation"
        onClick={openGifBuddySearch}
      >
        <ExternalLink className="size-3.5 mr-1.5" />
        {t('Search on GifBuddy')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t('Opens GifBuddy in a new tab. Copy a GIF URL there, then paste it below.')}
      </p>
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">{t('Paste URL of a GIF')}</Label>
        <div className="flex gap-1">
          <Input
            placeholder="https://..."
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            className="flex-1 min-w-0"
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0 touch-manipulation"
            disabled={!pasteUrl.trim() || publishingPaste}
            onClick={handlePasteUrlInsert}
            title={t('Insert URL into your post and publish to Nostr GIF library (NIP-94).')}
          >
            {publishingPaste ? t('Adding…') : t('Insert')}
          </Button>
        </div>
      </div>
      {isLoggedIn && (
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">
            {t('Description (optional, for search)')}
          </Label>
          <Input
            placeholder={t('e.g. happy birthday, thumbs up')}
            value={publishDescription}
            onChange={(e) => setPublishDescription(e.target.value)}
            className="min-w-0"
          />
        </div>
      )}
      {isLoggedIn && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gif,image/gif"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full touch-manipulation"
            disabled={uploading}
            onClick={triggerFileUpload}
          >
            {uploading ? t('Uploading...') : t('Add your own GIFs')}
          </Button>
          {uploadError && <p className="text-xs text-destructive text-center">{uploadError}</p>}
        </>
      )}
    </div>
  )

  const tabbedContent = (
    <div
      ref={pickerRootRef}
      data-gif-picker-root
      className={cn(
        'flex min-w-0 w-full flex-col gap-2 p-2',
        isDrawer ? 'min-h-0 flex-1 basis-0 overflow-hidden' : 'min-w-[280px] max-w-[360px]'
      )}
    >
      <div className="flex shrink-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{t('Choose a GIF')}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('size-8 shrink-0', isDrawer && 'touch-manipulation')}
          onClick={(e) => {
            e.stopPropagation()
            handleOpenChange(false)
          }}
          aria-label={t('Close')}
        >
          <X className="size-4" />
        </Button>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as GifPickerTab)}
        className={cn('flex flex-col', isDrawer && 'min-h-0 flex-1 basis-0 overflow-hidden')}
      >
        <TabsList className="grid h-auto w-full shrink-0 grid-cols-2 gap-0.5 p-1">
          <TabsTrigger
            value="find"
            className={cn('px-1.5 py-1.5 text-xs', isDrawer && 'touch-manipulation')}
          >
            {t('Find GIF')}
          </TabsTrigger>
          <TabsTrigger
            value="import"
            className={cn('px-1.5 py-1.5 text-xs', isDrawer && 'touch-manipulation')}
          >
            {t('Import GIF')}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="find"
          className={cn(
            'mt-2 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0',
            isDrawer ? 'flex min-h-0 flex-1 basis-0 flex-col overflow-hidden' : 'flex flex-col'
          )}
        >
          {findPanel}
        </TabsContent>
        <TabsContent
          value="import"
          className={cn(
            'mt-2 data-[state=inactive]:hidden focus-visible:ring-0 focus-visible:ring-offset-0',
            isDrawer ? 'min-h-0 flex-1 overflow-y-auto overscroll-y-contain' : ''
          )}
          {...(isDrawer && { 'data-vaul-no-drag': true })}
        >
          {importPanel}
        </TabsContent>
      </Tabs>
    </div>
  )

  if (isSmallScreen) {
    return (
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        onAnimationEnd={handleDrawerAnimationEnd}
        handleOnly
        shouldScaleBackground={false}
        repositionInputs={false}
      >
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent
          dragHandle="vaul"
          portalContainer={portalContainer}
          className="flex flex-col px-2 pb-2"
          style={mobileDrawerStyle ?? { maxHeight: 'min(88dvh, calc(100dvh - 3rem))' }}
          onPointerDownOutside={(e) => {
            const t = e.target as HTMLElement | null
            if (t?.closest?.('[data-vaul-overlay]')) return
            e.preventDefault()
          }}
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t('Choose a GIF')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex h-full min-h-0 w-full min-w-0 max-w-[100vw] flex-1 basis-0 flex-col overflow-hidden">
            {drawerContentMounted ? tabbedContent : null}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  if (useDialogShell) {
    const portalTarget = portalContainer ?? (typeof document !== 'undefined' ? document.body : null)
    const overlayPositionClass = portalContainer ? 'absolute inset-0' : 'fixed inset-0'
    return (
      <>
        <Slot
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation()
            handleOpenChange(true)
          }}
        >
          {children}
        </Slot>
        {open && portalTarget
          ? createPortal(
              <div
                data-gif-picker-shell
                className={cn(
                  'pointer-events-none z-[290] flex items-center justify-center p-4',
                  overlayPositionClass
                )}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('Close')}
                  className="pointer-events-auto absolute inset-0 z-0 cursor-default border-0 bg-transparent p-0"
                  onClick={() => handleOpenChange(false)}
                />
                <div
                  ref={composerPanelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t('Choose a GIF')}
                  className="pointer-events-auto relative z-10 flex max-h-[min(85dvh,640px)] w-[min(360px,calc(100vw-2rem))] max-w-[360px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{tabbedContent}</div>
                </div>
              </div>,
              portalTarget
            )
          : null}
      </>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        className="max-h-[min(560px,70dvh)] overflow-hidden p-0"
        portalContainer={portalContainer}
      >
        {tabbedContent}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
