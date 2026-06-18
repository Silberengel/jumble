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
import { Skeleton } from '@/components/ui/skeleton'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useUserReadInboxUrls, useUserWriteOutboxUrls } from '@/hooks/useUserMailboxRelayUrls'
import { useNostr } from '@/providers/NostrProvider'
import { ExtendedKind, GIF_RELAY_URLS } from '@/constants'
import { normalizeUrl } from '@/lib/url'
import { cn } from '@/lib/utils'
import {
  fetchMemes,
  getCachedMemes,
  mergeMemesIntoIdbCache,
  memeMetadataFrom1063Event,
  searchMemes,
  type MemeMetadata
} from '@/services/meme.service'
import mediaUpload from '@/services/media-upload.service'
import { ExternalLink, X } from 'lucide-react'
import { Slot } from '@radix-ui/react-slot'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** In-session cache: survives Drawer/Dropdown open↔close without a relay re-fetch. */
let _sessionMemes: MemeMetadata[] = []
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const MEMEAMIGO_URL = 'https://www.memeamigo.lol/'
const MEMEAMIGO_SEARCH_URL = (q: string) =>
  q.trim() ? `${MEMEAMIGO_URL}?q=${encodeURIComponent(q.trim())}` : MEMEAMIGO_URL

function listFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled'))
}

function mimeFromImageUrl(url: string): string {
  const lower = url.toLowerCase().split('?')[0] ?? ''
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/jpeg'
}

function isStaticImageFile(file: File): boolean {
  const n = file.name.toLowerCase()
  const t = file.type.toLowerCase()
  return (
    t === 'image/jpeg' ||
    t === 'image/png' ||
    t === 'image/webp' ||
    n.endsWith('.jpg') ||
    n.endsWith('.jpeg') ||
    n.endsWith('.png') ||
    n.endsWith('.webp')
  )
}

export default function MemePicker({
  children,
  onSelect,
  portalContainer
}: {
  children: React.ReactNode
  onSelect?: (imageUrl: string) => void
  portalContainer?: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const inDialog = useContext(DialogContext)
  /** Post composer on desktop: centered portal panel (dropdown clips inside dialog). */
  const useDialogShell = inDialog && !isSmallScreen
  const { publish, pubkey } = useNostr()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  // Initialise from the module-level session cache so re-opens are instant
  const [memes, setMemesState] = useState<MemeMetadata[]>(() => _sessionMemes)
  const memesRef = useRef<MemeMetadata[]>(_sessionMemes)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [publishingPaste, setPublishingPaste] = useState(false)
  const [publishDescription, setPublishDescription] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const memeamigoPopupRef = useRef<Window | null>(null)
  const pickerRootRef = useRef<HTMLDivElement>(null)
  const composerPanelRef = useRef<HTMLDivElement>(null)
  const searchFieldRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const userReadRelays = useUserReadInboxUrls()
  const userWriteRelays = useUserWriteOutboxUrls()

  /** Keep memesRef, session cache, and React state in sync. */
  const setMemes = useCallback((newMemes: MemeMetadata[], isSearch = false) => {
    memesRef.current = newMemes
    if (!isSearch) _sessionMemes = newMemes
    setMemesState(newMemes)
  }, [])

  const loadMemes = useCallback(
    async (q: string, forceRefresh = false) => {
      setError(null)
      const isSearch = q.trim() !== ''

      if (isSearch) {
        memesRef.current = []
        setMemesState([])
        setLoading(true)
      } else if (memesRef.current.length === 0) {
        try {
          const cached = await getCachedMemes(pubkey ?? null)
          if (cached.length > 0) {
            setMemes(cached)
          }
        } catch { /* ignore */ }
        if (memesRef.current.length === 0) setLoading(true)
      }

      try {
        const results = isSearch
          ? await searchMemes(q.trim(), 50, forceRefresh, userReadRelays, pubkey ?? null)
          : await fetchMemes(undefined, 50, forceRefresh, userReadRelays, pubkey ?? null)
        setMemes(results, isSearch)
        if (results.length === 0 && !isSearch) {
          setError(
            t(
              'No meme templates found. Try searching or open Meme Amigo. The grid only lists kind 1063 (NIP-94) files tagged memeamigo (not random photos from notes).'
            )
          )
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load memes')
        if (memesRef.current.length === 0) setMemesState([])
      } finally {
        setLoading(false)
      }
    },
    [t, userReadRelays, pubkey, setMemes]
  )

  useEffect(() => {
    if (!open) return
    loadMemes(query)
  }, [open, query, loadMemes])

  useEffect(() => {
    if (!open) return
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setQuery(searchInput)
    }, 300)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchInput, open])

  const preparePickerClose = useCallback(() => {
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
    const raf = requestAnimationFrame(focusSearch)
    const timer = window.setTimeout(focusSearch, 0)

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
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, useDialogShell])

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

  const handleSelect = (meme: MemeMetadata) => {
    const url = meme.fallbackUrl || meme.url
    onSelect?.(url)
    handleOpenChange(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pubkey) return
    setUploadError(null)
    setUploading(true)
    try {
      if (!isStaticImageFile(file)) {
        setUploadError(t('{{name}} is not a JPEG, PNG, or WebP file', { name: file.name }))
        return
      }
      const { url } = await mediaUpload.upload(file)
      const mime = file.type || mimeFromImageUrl(url)
      const draft = {
        kind: ExtendedKind.FILE_METADATA,
        content: publishDescription.trim(),
        tags: [
          ['file', url, mime, `size ${file.size}`],
          ['url', url],
          ['m', mime],
          ['t', 'memeamigo']
        ],
        created_at: Math.floor(Date.now() / 1000)
      }
      const writeUrls = [...GIF_RELAY_URLS, ...userWriteRelays]
      const seen = new Set<string>()
      const specifiedRelayUrls = writeUrls.filter((u) => {
        const n = (normalizeUrl(u) ?? u).toLowerCase()
        if (seen.has(n)) return false
        seen.add(n)
        return true
      })
      const published = await publish(draft, { specifiedRelayUrls })
      const meta = memeMetadataFrom1063Event(published)
      if (meta) {
        await mergeMemesIntoIdbCache([meta])
        const next = [meta, ...memesRef.current.filter((m) => m.eventId !== meta.eventId)].slice(0, 50)
        setMemes(next)
      }
      setPublishDescription('')
      setQuery('')
      await loadMemes('', false)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const triggerFileUpload = () => fileInputRef.current?.click()

  const isLoggedIn = !!pubkey

  const openMemeAmigoSearch = useCallback(() => {
    const url = MEMEAMIGO_SEARCH_URL(searchInput)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    memeamigoPopupRef.current = w ?? null
    const handler = (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.memeamigo.lol' &&
        event.origin !== 'https://memeamigo.lol'
      ) {
        return
      }
      const data = event.data
      const urlToInsert =
        typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))
          ? data
          : data?.url ?? data?.imageUrl
      if (urlToInsert && typeof urlToInsert === 'string') {
        window.removeEventListener('message', handler)
        memeamigoPopupRef.current = null
        onSelect?.(urlToInsert)
        handleOpenChange(false)
      }
    }
    window.addEventListener('message', handler)
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      memeamigoPopupRef.current = null
    }, 10 * 60 * 1000)
    if (w)
      w.addEventListener('beforeunload', () => {
        clearTimeout(timer)
        window.removeEventListener('message', handler)
      })
  }, [searchInput, onSelect, handleOpenChange])

  const descriptionForPublish = publishDescription.trim()

  const handlePasteUrlInsert = useCallback(async () => {
    const url = pasteUrl.trim()
    if (!url || !/^https?:\/\//i.test(url)) return
    onSelect?.(url)
    setPasteUrl('')
    handleOpenChange(false)
    if (pubkey) {
      setPublishingPaste(true)
      try {
        const mime = mimeFromImageUrl(url)
        const draft = {
          kind: ExtendedKind.FILE_METADATA,
          content: descriptionForPublish,
          tags: [
            ['file', url, mime, 'size 0'],
            ['url', url],
            ['m', mime],
            ['t', 'memeamigo']
          ],
          created_at: Math.floor(Date.now() / 1000)
        }
        const writeUrls = [...GIF_RELAY_URLS, ...userWriteRelays]
        const seen = new Set<string>()
        const specifiedRelayUrls = writeUrls.filter((u) => {
          const n = (normalizeUrl(u) ?? u).toLowerCase()
          if (seen.has(n)) return false
          seen.add(n)
          return true
        })
        const published = await publish(draft, { specifiedRelayUrls })
        const meta = memeMetadataFrom1063Event(published)
        if (meta) {
          await mergeMemesIntoIdbCache([meta])
        }
        setPublishDescription('')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t('Failed to publish meme template for the picker')
        )
      } finally {
        setPublishingPaste(false)
      }
    }
  }, [pasteUrl, pubkey, onSelect, publish, userWriteRelays, descriptionForPublish, handleOpenChange, t])

  const isDrawer = isSmallScreen
  const content = (
    <div
      ref={pickerRootRef}
      data-meme-picker-root
      className={cn(
        'flex min-w-0 w-full flex-col gap-2 p-2',
        isDrawer ? 'min-h-0 flex-1 overflow-hidden' : 'min-w-[280px] max-w-[360px]'
      )}
    >
      <div className="flex items-center gap-1 shrink-0">
        <Input
          ref={searchFieldRef}
          placeholder={t('Search memes')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 size-8"
          onClick={() => handleOpenChange(false)}
          aria-label={t('Close')}
        >
          <X className="size-4" />
        </Button>
      </div>
      {error && <p className="text-sm text-muted-foreground px-1 shrink-0">{error}</p>}
      <div
        className={cn(isDrawer && 'flex min-h-0 flex-1 flex-col')}
        {...(isDrawer && { 'data-vaul-no-drag': true })}
      >
        {isDrawer ? (
          <div className="page-scroll-y min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y rounded-md border">
            {loading ? (
              <div
                className="grid grid-cols-2 gap-1 p-2 min-h-[200px]"
                role="status"
                aria-busy="true"
                aria-live="polite"
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square w-full rounded" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1 p-2">
                {memes.map((meme) => (
                  <button
                    key={meme.eventId}
                    type="button"
                    className="rounded overflow-hidden border border-transparent hover:border-primary focus:border-primary focus:outline-none aspect-square"
                    onClick={() => handleSelect(meme)}
                  >
                    <img
                      src={meme.url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement
                        const fallback = meme.fallbackUrl?.trim()
                        if (fallback && el.dataset.memeFallbackTried !== '1') {
                          el.dataset.memeFallbackTried = '1'
                          el.src = fallback
                          return
                        }
                        el.style.display = 'none'
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
        <ScrollArea className="h-[280px] w-full rounded-md border">
          {loading ? (
            <div
              className="grid grid-cols-2 gap-1 p-2 min-h-[200px]"
              role="status"
              aria-busy="true"
              aria-live="polite"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square w-full rounded" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 p-2">
              {memes.map((meme) => (
                <button
                  key={meme.eventId}
                  type="button"
                  className="rounded overflow-hidden border border-transparent hover:border-primary focus:border-primary focus:outline-none aspect-square"
                  onClick={() => handleSelect(meme)}
                >
                  <img
                    src={meme.url}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement
                      const fallback = meme.fallbackUrl?.trim()
                      if (fallback && el.dataset.memeFallbackTried !== '1') {
                        el.dataset.memeFallbackTried = '1'
                        el.src = fallback
                        return
                      }
                      el.style.display = 'none'
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t pt-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={openMemeAmigoSearch}
          >
            <ExternalLink className="size-3.5 mr-1.5" />
            {t('Search on Meme Amigo')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t(
              'Opens in a new tab. Copy an image URL there, then paste below. If this picker closed, click “Insert meme” again to paste.'
            )}
          </p>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              {t('Paste URL of a meme image')}
            </Label>
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
                disabled={!pasteUrl.trim() || publishingPaste}
                onClick={handlePasteUrlInsert}
                title={t(
                  'Insert URL into your post and publish kind 1063 (NIP-94) with hashtag memeamigo for discoverability.'
                )}
              >
                {publishingPaste ? t('Adding…') : t('Insert')}
              </Button>
            </div>
          </div>
        </div>
        {isLoggedIn && (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              {t('Description (optional, for search)')}
            </Label>
            <Input
              placeholder={t('e.g. drake, distracted boyfriend')}
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
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={uploading}
              onClick={triggerFileUpload}
            >
              {uploading ? t('Uploading...') : t('Add your own meme templates')}
            </Button>
            {uploadError && (
              <p className="text-xs text-destructive text-center">{uploadError}</p>
            )}
          </>
        )}
      </div>
    </div>
  )

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} handleOnly shouldScaleBackground={false}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent
          dragHandle="vaul"
          portalContainer={portalContainer}
          className="max-h-[min(88dvh,calc(100dvh-5rem))] px-2 pb-2"
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t('Choose a meme')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 w-full min-w-0 max-w-[100vw] flex-1 flex-col overflow-hidden">
            {content}
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
                data-meme-picker-shell
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
                  aria-label={t('Choose a meme')}
                  className="pointer-events-auto relative z-10 flex max-h-[min(85dvh,640px)] w-[min(360px,calc(100vw-2rem))] max-w-[360px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>
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
      <DropdownMenuContent side="top" className="p-0" portalContainer={portalContainer}>
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
