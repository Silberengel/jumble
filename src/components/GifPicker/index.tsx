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
  type GifMetadata
} from '@/services/gif.service'
import {
  REACTION_CLIP_EMOTIONS,
  REACTION_CLIP_MAX_EMOTIONS,
  buildReactionClipDraft,
  fetchAndHashMediaUrl,
  fetchRemoteMediaBytes,
  normalizeClipEmotions,
  sha256FromContentAddressedUrl
} from '@/lib/reaction-clip'
import { sha256HexOfFile } from '@/lib/upload-nip94-imeta'
import { mergeImetaTags } from '@/lib/composer-media-url-imeta'
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

const TENOR_URL = 'https://tenor.com/'
/** Stable empty follows list — avoids re-running picker fetch every render. */
const EMPTY_FOLLOWING_PUBKEYS: readonly string[] = []
/** Tenor search pages use dash-joined terms with a `-gifs` suffix. */
const TENOR_SEARCH_URL = (q: string) => {
  const terms = q.trim().split(/\s+/).filter(Boolean).map(encodeURIComponent)
  return terms.length > 0 ? `${TENOR_URL}search/${terms.join('-')}-gifs` : TENOR_URL
}

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
  const [selectedEmotions, setSelectedEmotions] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pickerRootRef = useRef<HTMLDivElement>(null)
  const composerPanelRef = useRef<HTMLDivElement>(null)
  const searchFieldRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [mobileDrawerStyle, setMobileDrawerStyle] = useState<CSSProperties | undefined>()
  const [activeTab, setActiveTab] = useState<GifPickerTab>('find')
  /** Keep drawer content mounted until Vaul's close animation finishes (avoids empty-sheet flicker). */
  const [drawerContentMounted, setDrawerContentMounted] = useState(false)

  const userReadRelays = useUserReadInboxUrls()

  /** Clip / kind 1063 publish targets — GIF relays only. */
  const gif1063PublishRelayUrls = useMemo(() => getGif1063RelayUrls(), [])

  /**
   * Publish a kind 1090 reaction clip when the draft-NIP requirements are met (media sha256 +
   * at least one emotion label), otherwise fall back to a legacy kind 1063 publish.
   */
  const publishClipOrLegacy = useCallback(
    async (input: {
      url: string
      description: string
      emotions: readonly string[]
      sha256?: string | null
      mimeType?: string
      dim?: string
      size?: number
    }) => {
      const emotions = normalizeClipEmotions(input.emotions)
      let sha256 = input.sha256?.trim().toLowerCase() || sha256FromContentAddressedUrl(input.url)
      let mimeType = input.mimeType
      let size = input.size
      if (!sha256 && emotions.length > 0) {
        const hashed = await fetchAndHashMediaUrl(input.url)
        if (hashed) {
          sha256 = hashed.sha256
          if (!mimeType && hashed.mimeType) mimeType = hashed.mimeType
          if (!size && hashed.size > 0) size = hashed.size
        }
      }
      // Feed the composer's imeta cache so the note that embeds this URL gets the
      // NIP-92 `x` hash and size too (enrichment merges rather than overwrites).
      const imetaItems = [`url ${input.url}`, `m ${mimeType || 'image/gif'}`]
      if (sha256) imetaItems.push(`x ${sha256}`)
      if (size && size > 0) imetaItems.push(`size ${size}`)
      if (input.dim?.trim()) imetaItems.push(`dim ${input.dim.trim()}`)
      mediaUpload.registerImetaTag(
        input.url,
        mergeImetaTags(['imeta', ...imetaItems], mediaUpload.getImetaTagByUrl(input.url))
      )

      const isClip = Boolean(sha256) && emotions.length > 0
      const draft = isClip
        ? buildReactionClipDraft({
            url: input.url,
            sha256: sha256!,
            mimeType,
            dim: input.dim,
            size,
            description: input.description,
            emotions
          })
        : buildKind1063GifPublishDraft(input.url, input.description)
      const published = await publish(draft, { specifiedRelayUrls: gif1063PublishRelayUrls })
      await cachePublishedGif({
        url: input.url,
        sha256: sha256 ?? undefined,
        mimeType: mimeType || 'image/gif',
        description: input.description || undefined,
        emotions: isClip ? emotions : undefined,
        sourceKind: draft.kind,
        eventId: published.id,
        pubkey: published.pubkey,
        createdAt: published.created_at
      })
      return published
    },
    [publish, gif1063PublishRelayUrls]
  )

  const toggleEmotion = useCallback((emotion: string) => {
    setSelectedEmotions((prev) => {
      if (prev.includes(emotion)) return prev.filter((e) => e !== emotion)
      if (prev.length >= REACTION_CLIP_MAX_EMOTIONS) return prev
      return [...prev, emotion]
    })
  }, [])

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
              'No GIFs found. Try searching or add your own. GIFs come from Nostr reaction clips (kind 1090) and kind 1063 (NIP-94) events on GIF relays.'
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
      const desc = publishDescription.trim() || gif.description?.trim() || ''
      onSelect?.(url)
      handleOpenChange(false)
      if (!pubkey || !/^https?:\/\//i.test(url)) return
      // Fire-and-forget: waiting on every relay can freeze the UI when relays are down.
      // Reuses the source clip's emotions so re-picking someone's 1090 republishes a proper clip.
      void publishClipOrLegacy({
        url,
        description: desc,
        emotions: gif.emotions?.length ? gif.emotions : selectedEmotions,
        sha256: gif.sha256,
        mimeType: gif.mimeType,
        dim: gif.width && gif.height ? `${gif.width}x${gif.height}` : undefined
      }).catch(() => {})
      if (publishDescription.trim()) setPublishDescription('')
    },
    [pubkey, onSelect, publishClipOrLegacy, selectedEmotions, publishDescription, handleOpenChange]
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
      const { url, tags: uploadTags } = await mediaUpload.upload(file)
      const desc = publishDescription.trim()
      const tagValue = (name: string) =>
        uploadTags.find((row) => row[0] === name && row[1]?.trim())?.[1]?.trim()
      const sha256 = tagValue('x') ?? (await sha256HexOfFile(file))
      await publishClipOrLegacy({
        url,
        description: desc,
        emotions: selectedEmotions,
        sha256,
        mimeType: file.type || 'image/gif',
        dim: tagValue('dim'),
        size: file.size
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

  /**
   * Download an external GIF and re-upload it to the user's media server (Blossom/NIP-96),
   * so the clip is content-addressed on infrastructure the user controls instead of pointing
   * at Tenor/Giphy. Returns the hosted URL + NIP-94 tags, or null (CORS, non-image, upload error).
   */
  const mirrorGifToMediaServer = useCallback(
    async (url: string): Promise<{ url: string; tags: string[][] } | null> => {
      const media = await fetchRemoteMediaBytes(url)
      if (!media) return null
      const pathname = (() => {
        try {
          return new URL(url).pathname
        } catch {
          return ''
        }
      })()
      // Only mirror actual GIFs: they pass through upload compression unchanged, while other
      // animated rasters (webp/apng) would be flattened to a single frame by the canvas re-encode.
      const isGif = media.mimeType
        ? media.mimeType === 'image/gif'
        : /\.gif$/i.test(pathname)
      if (!isGif) return null
      const name = pathname.split('/').pop()?.trim() || 'clip.gif'
      const file = new File([media.buf], name, { type: 'image/gif' })
      try {
        return await mediaUpload.upload(file)
      } catch {
        return null
      }
    },
    []
  )

  /** Open Tenor in a new tab (not a popup) so the picker doesn't close from focus loss. */
  const openTenorSearch = useCallback(() => {
    window.open(TENOR_SEARCH_URL(pasteUrl || searchInput), '_blank', 'noopener,noreferrer')
  }, [pasteUrl, searchInput])

  const descriptionForPublish = publishDescription.trim()

  /**
   * Pasted GIF URL: mirror the bytes to the user's media server (Blossom/NIP-96), insert the
   * hosted URL, and publish it to the Nostr GIF library (kind 1090 clip when possible).
   * If mirroring fails (CORS, not logged in, upload error) the original URL is inserted instead.
   */
  const handlePasteUrlInsert = useCallback(async () => {
    const url = pasteUrl.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    if (!pubkey) {
      onSelect?.(url)
      setPasteUrl('')
      handleOpenChange(false)
      return
    }
    setPublishingPaste(true)
    try {
      const mirrored = await mirrorGifToMediaServer(url)
      const finalUrl = mirrored?.url ?? url
      const tagValue = (name: string) =>
        mirrored?.tags.find((row) => row[0] === name && row[1]?.trim())?.[1]?.trim()
      onSelect?.(finalUrl)
      setPasteUrl('')
      handleOpenChange(false)
      // Fire-and-forget: relay publish must not block the editor after insert.
      void publishClipOrLegacy({
        url: finalUrl,
        description: descriptionForPublish,
        emotions: selectedEmotions,
        sha256: tagValue('x'),
        mimeType: tagValue('m'),
        dim: tagValue('dim'),
        size: Number(tagValue('size')) || undefined
      })
        .then(() => setPublishDescription(''))
        .catch(() => {})
    } finally {
      setPublishingPaste(false)
    }
  }, [
    pasteUrl,
    pubkey,
    onSelect,
    mirrorGifToMediaServer,
    publishClipOrLegacy,
    selectedEmotions,
    descriptionForPublish,
    handleOpenChange
  ])

  /**
   * External GIF from a note: mirror to the user's media server, publish clip/1063 for the
   * hosted URL, then insert it and close (falls back to the original URL if mirroring fails).
   */
  const handleArchiveAndInsert = useCallback(
    async (e: React.MouseEvent, gif: GifMetadata) => {
      e.preventDefault()
      e.stopPropagation()
      if (!pubkey) return
      const url = (gif.fallbackUrl?.trim() || gif.url).trim()
      if (!url || !/^https?:\/\//i.test(url)) return
      const desc = publishDescription.trim() || gif.description?.trim() || ''
      setArchivingEventId(gif.eventId)
      try {
        const mirrored = await mirrorGifToMediaServer(url)
        const finalUrl = mirrored?.url ?? url
        const tagValue = (name: string) =>
          mirrored?.tags.find((row) => row[0] === name && row[1]?.trim())?.[1]?.trim()
        onSelect?.(finalUrl)
        handleOpenChange(false)
        void loadGifs(true)
        void publishClipOrLegacy({
          url: finalUrl,
          description: desc,
          emotions: gif.emotions?.length ? gif.emotions : selectedEmotions,
          sha256: tagValue('x') ?? gif.sha256,
          mimeType: tagValue('m') ?? gif.mimeType,
          dim:
            tagValue('dim') ??
            (gif.width && gif.height ? `${gif.width}x${gif.height}` : undefined),
          size: Number(tagValue('size')) || undefined
        })
          .catch(() => {})
          .finally(() => {
            if (publishDescription.trim()) setPublishDescription('')
          })
      } finally {
        setArchivingEventId(null)
      }
    },
    [
      pubkey,
      mirrorGifToMediaServer,
      publishClipOrLegacy,
      selectedEmotions,
      onSelect,
      loadGifs,
      publishDescription,
      handleOpenChange
    ]
  )

  const gifSourceKindTitle = useCallback(
    (gif: GifMetadata) => {
      if (gif.sourceKind === ExtendedKind.REACTION_CLIP) {
        const emotions = gif.emotions?.join(', ')
        return emotions
          ? t('Reaction clip (kind 1090), content-addressed by the sha256 of its bytes. Emotions: {{emotions}}', { emotions })
          : t('Reaction clip (kind 1090), content-addressed by the sha256 of its bytes.')
      }
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
    if (gif.sourceKind === ExtendedKind.REACTION_CLIP) return '1090'
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
                    'Publish this GIF to the Nostr GIF library (reaction clip when possible) and insert the URL into your post'
                  )}
                  aria-label={t(
                    'Publish this GIF to the Nostr GIF library (reaction clip when possible) and insert the URL into your post'
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
      <p className="text-xs text-muted-foreground">{t('Paste a GIF URL, upload your own file, or search Tenor.')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full touch-manipulation"
        onClick={openTenorSearch}
      >
        <ExternalLink className="size-3.5 mr-1.5" />
        {t('Search on Tenor')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t('Opens Tenor in a new tab. Copy a GIF URL there, then paste it below.')}
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
            title={t('Copies the GIF to your media server, inserts the hosted URL into your post, and publishes it to the Nostr GIF library.')}
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
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">{t('Emotions (up to 6)')}</Label>
          <div className="flex flex-wrap gap-1">
            {REACTION_CLIP_EMOTIONS.map((emotion) => {
              const active = selectedEmotions.includes(emotion)
              return (
                <button
                  key={emotion}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleEmotion(emotion)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs touch-manipulation transition-colors',
                    active
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/60'
                  )}
                >
                  {emotion}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('With at least one emotion your GIF is published as a reaction clip (kind 1090, browsable by emotion); without emotions it falls back to legacy kind 1063.')}
          </p>
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
