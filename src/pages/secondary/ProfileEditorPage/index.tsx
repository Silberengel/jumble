import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import Uploader from '@/components/PostEditor/Uploader'
import ProfileBanner from '@/components/ProfileBanner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { createPaymentInfoDraftEvent, createProfileDraftEvent } from '@/lib/draft-event'
import { generateImageByPubkey } from '@/lib/pubkey'
import { syncUserDeletionTombstones } from '@/lib/sync-user-deletions'
import { useSecondaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { canUseNostrBuildThumb, toNostrBuildThumbUrl } from '@/lib/nostr-build'
import { isVideo } from '@/lib/url'
import { EditorSortableList, SortableEditorRow } from '@/components/EditorSortableList'
import PaymentMethodRow from '@/components/ProfileEditor/PaymentMethodRow'
import { arrayMove } from '@dnd-kit/sortable'
import { PAYTO_EDITOR_OTHER_OPTION } from '@/lib/payto'
import { normalizePaypalAuthority } from '@/lib/payto-paypal-url'
import { ChevronDown, Fingerprint, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toastPublishPromise } from '@/lib/publishing-feedback'
import { toast } from 'sonner'

/** Required tag fields: always exactly one row, cannot be deleted. */
const SINGLETON_NAMES = ['display_name', 'name', 'about', 'picture', 'banner']
/**
 * Optional fields that may appear at most once.
 * Rows are deletable but a second instance is blocked.
 */
const UNIQUE_NAMES = ['bot', 'birthday']
/** Tags that may appear multiple times (nip05, lud16, website). */
const MULTI_NAMES = ['nip05', 'lud16', 'website']
/** Tags managed automatically by the client – hidden from the editor. */
const AUTO_NAMES = new Set(['alt', 'client'])
/** All "at most one" names (singletons + unique-optional). */
const AT_MOST_ONE_NAMES = [...SINGLETON_NAMES, ...UNIQUE_NAMES]
/** All named tags the editor knows about (label + display order). */
const KNOWN_NAMES = [...SINGLETON_NAMES, ...UNIQUE_NAMES, ...MULTI_NAMES]
/** Canonical display order for the tag list. */
const DISPLAY_ORDER = ['display_name', 'name', 'about', 'picture', 'banner', 'nip05', 'lud16', 'website', 'bot', 'birthday']
/** Options shown in the "add tag" dropdown, in this order. */
const ADD_TAG_OPTIONS = ['nip05', 'lud16', 'website', 'bot', 'birthday'] as const

const TAG_LABELS: Record<string, string> = {
  display_name: 'Display Name',
  name: 'Name',
  about: 'Bio',
  picture: 'Profile Picture',
  banner: 'Banner',
  nip05: 'Nostr Address (NIP-05)',
  lud16: 'Lightning Address',
  website: 'Website',
  bot: 'Bot',
  birthday: 'Birthday',
}

/**
 * Profile banner & avatar file picker: all images and videos the OS/browser exposes as
 * `image/*` or `video/*`, plus common extensions when `File.type` is empty (e.g. Linux).
 * Banner and avatar sizes are limited after compression (`maxCompressedSizeMb` on each uploader).
 */
const PROFILE_IMAGE_VIDEO_UPLOADER_ACCEPT = [
  'image/*',
  'video/*',
  '.mkv',
  '.m4v',
  '.mov',
  '.webm',
  '.ogv',
  '.avi',
  '.mpeg',
  '.mpg',
  '.mp4',
  '.3gp',
  '.wmv',
  '.flv',
  '.heic',
  '.heif',
  '.avif',
  '.apng',
  '.svg',
  '.webp',
  '.gif',
  '.png',
  '.jpg',
  '.jpeg',
  '.bmp',
  '.ico',
  'video/x-matroska'
].join(',')

const ProfileEditorPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()
  const {
    account,
    profile,
    profileEvent,
    publish,
    updateProfileEvent,
    relayList,
    requestAccountNetworkHydrate
  } = useNostr()

  const [hasChanged, setHasChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [paymentInfoEvent, setPaymentInfoEvent] = useState<Event | null>(null)
  const [paymentInfoEditOpen, setPaymentInfoEditOpen] = useState(false)
  const [paymentInfoEditMethods, setPaymentInfoEditMethods] = useState<EditorPaymentMethodRow[]>([])
  /** Kind 10133 `content` preserved from the opened event; not edited in the UI (payto tags only). */
  const paymentInfoDraftContentRef = useRef('{}')
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false)
  const savingPaymentInfoRef = useRef(false)
  const [profileEventJson, setProfileEventJson] = useState<string>('')
  const [savingFullProfile, setSavingFullProfile] = useState(false)
  const [refreshingCache, setRefreshingCache] = useState(false)
  /** Single source of truth: all profile tags (excluding auto-managed client/alt). */
  const [profileTagRows, setProfileTagRows] = useState<EditorTagRow[]>([])
  const [imageUrlField, setImageUrlField] = useState<'picture' | 'banner' | null>(null)
  const [imageUrlDraft, setImageUrlDraft] = useState('')
  const [tagToAdd, setTagToAdd] = useState<string>(ADD_TAG_OPTIONS[0])

  const defaultImage = useMemo(
    () => (account ? generateImageByPubkey(account.pubkey) : undefined),
    [account]
  )

  /** Derived from profile tag rows so uploaders and visual preview stay in sync. */
  const avatar = profileTagRows.find((r) => r.tag[0] === 'picture')?.tag[1] ?? ''
  const banner = profileTagRows.find((r) => r.tag[0] === 'banner')?.tag[1] ?? ''

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** Block profileEvent → form sync while editing or while publish is in flight. */
  const profileFormSyncLocked = hasChanged || saving || savingFullProfile

  // Rebuild tag list when the stored profile event changes — not while the user is editing.
  useEffect(() => {
    if (profileFormSyncLocked) return
    setProfileTagRows(tagRowsFromTags(buildTagListFromEvent(profileEvent ?? null)))
  }, [profileEvent, profileFormSyncLocked])

  // Live full-event JSON preview from the current tag list (reorder, edit, add, remove).
  useEffect(() => {
    if (!profileEvent) return
    setProfileEventJson(buildProfileEventJsonFromTagRows(profileEvent, profileTagRows))
  }, [profileTagRows, profileEvent])

  // Fetch payment info (kind 10133).
  useEffect(() => {
    if (!account?.pubkey) { setPaymentInfoEvent(null); return }
    let cancelled = false
    client
      .fetchPaymentInfoEvent(account.pubkey)
      .then((evt) => { if (!cancelled) setPaymentInfoEvent(evt ?? null) })
      .catch(() => { if (!cancelled) setPaymentInfoEvent(null) })
    return () => { cancelled = true }
  }, [account?.pubkey])

  // ─── Tag list helpers ────────────────────────────────────────────────────────

  const updateTagValue = (id: string, value: string) => {
    setProfileTagRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, tag: [row.tag[0], value, ...row.tag.slice(2)] } : row
      )
    )
    setHasChanged(true)
  }

  const updateTagName = (id: string, name: string) => {
    if (AT_MOST_ONE_NAMES.includes(name)) {
      const existing = profileTagRows.find((row) => row.tag[0] === name)
      if (existing && existing.id !== id) {
        toast.error(t('profileEditorDuplicateSingleton', { defaultValue: `"${name}" may only appear once` }))
        return
      }
    }
    setProfileTagRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, tag: [name, row.tag[1] ?? '', ...row.tag.slice(2)] } : row
      )
    )
    setHasChanged(true)
  }

  const removeTag = (id: string) => {
    setProfileTagRows((prev) => prev.filter((row) => row.id !== id))
    setHasChanged(true)
  }

  const reorderProfileTagRows = (fromIndex: number, toIndex: number) => {
    setProfileTagRows((prev) => arrayMove(prev, fromIndex, toIndex))
    setHasChanged(true)
  }

  const addTag = (name = '', value = '') => {
    if (name && AT_MOST_ONE_NAMES.includes(name) && profileTagRows.some((row) => row.tag[0] === name)) {
      toast.error(t('profileEditorDuplicateSingleton', { defaultValue: `"${name}" may only appear once` }))
      return
    }
    setProfileTagRows((prev) => [...prev, { id: newEditorId(), tag: [name, value] }])
    setHasChanged(true)
  }

  // ─── Payment info ────────────────────────────────────────────────────────────

  const paymentInfoPreviewJson = useMemo(
    () =>
      JSON.stringify(
        createPaymentInfoDraftEvent(
          paymentInfoDraftContentRef.current,
          paymentMethodsToPaytoTags(paymentInfoEditMethods)
        ),
        null,
        2
      ),
    [paymentInfoEditMethods, paymentInfoEditOpen]
  )

  const openPaymentInfoEditor = useCallback(() => {
    if (paymentInfoEvent) {
      paymentInfoDraftContentRef.current =
        typeof paymentInfoEvent.content === 'string'
          ? paymentInfoEvent.content
          : JSON.stringify(paymentInfoEvent.content ?? '', null, 2)
      const paytoTags = (paymentInfoEvent.tags ?? []).filter(
        (tag) => Array.isArray(tag) && tag[0] === 'payto' && tag[1] != null
      )
      setPaymentInfoEditMethods(
        paytoTags.length > 0
          ? paytoTags.map((tag) => ({
              id: newEditorId(),
              type: (tag[1] as string) || 'lightning',
              authority: (tag[2] as string) || ''
            }))
          : [{ id: newEditorId(), type: 'lightning', authority: '' }]
      )
    } else {
      paymentInfoDraftContentRef.current = '{}'
      setPaymentInfoEditMethods([{ id: newEditorId(), type: 'lightning', authority: '' }])
    }
    setPaymentInfoEditOpen(true)
  }, [paymentInfoEvent])

  const savePaymentInfo = useCallback(async () => {
    if (savingPaymentInfoRef.current) return
    const tags = paymentMethodsToPaytoTags(paymentInfoEditMethods)
    savingPaymentInfoRef.current = true
    setSavingPaymentInfo(true)
    try {
      const contentStr = paymentInfoDraftContentRef.current.trim() || '{}'
      const draft = createPaymentInfoDraftEvent(contentStr, tags)
      const published = await publish(draft)
      await client.updatePaymentInfoCache(published)
      setPaymentInfoEvent(published)
      setPaymentInfoEditOpen(false)
      toast.success(t('Payment info updated'))
    } catch {
      toast.error(t('Failed to publish payment info'))
    } finally {
      savingPaymentInfoRef.current = false
      setSavingPaymentInfo(false)
    }
  }, [paymentInfoEditMethods, publish, t])

  // ─── Cache refresh ───────────────────────────────────────────────────────────

  const forceRefreshProfileAndPaymentCache = useCallback(async () => {
    if (!account?.pubkey) return
    setRefreshingCache(true)
    try {
      await requestAccountNetworkHydrate()
      await syncUserDeletionTombstones(account.pubkey, relayList)
      await client.forceRefreshProfileAndPaymentInfoCache(account.pubkey)
      const [profileEvt, paymentEvt] = await Promise.all([
        client.fetchProfileEvent(account.pubkey, false, { allowWideRelayFallback: true }),
        client.fetchPaymentInfoEvent(account.pubkey)
      ])
      if (profileEvt) {
        await updateProfileEvent(profileEvt)
        const refreshedRows = tagRowsFromTags(buildTagListFromEvent(profileEvt))
        setProfileTagRows(refreshedRows)
        setProfileEventJson(buildProfileEventJsonFromTagRows(profileEvt, refreshedRows))
        setHasChanged(false)
      }
      setPaymentInfoEvent(paymentEvt ?? null)
      toast.success(t('Profile and payment cache refreshed'))
    } catch {
      toast.error(t('Failed to refresh cache'))
    } finally {
      setRefreshingCache(false)
    }
  }, [account?.pubkey, relayList, requestAccountNetworkHydrate, updateProfileEvent, t])

  const refreshCacheControl = (
    <div className="pr-3 flex flex-wrap items-center justify-end gap-2 min-w-0">
      <Button
        variant="outline"
        size="sm"
        onClick={forceRefreshProfileAndPaymentCache}
        disabled={refreshingCache}
        className="gap-1.5 max-w-full"
        title={t('profileEditorRefreshCacheHint', {
          defaultValue:
            'Full account sync from relays (like Settings → Cache), deletion tombstones, then profile and payment info.'
        })}
      >
        {refreshingCache ? (
          <Skeleton className="size-3.5 shrink-0 rounded-sm" aria-hidden />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {t('Refresh cache')}
      </Button>
    </div>
  )

  // ─── Guards ──────────────────────────────────────────────────────────────────

  if (!account) return null

  if (!profile) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title="…" controls={refreshCacheControl}>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground text-sm">
          <Skeleton className="h-4 w-48 rounded" />
          <p>
            {t('profileEditorProfileNotLoaded', {
              defaultValue: 'Profile not loaded. Try refreshing the cache.'
            })}
          </p>
        </div>
      </SecondaryPageLayout>
    )
  }

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const openImageUrlEditor = (field: 'picture' | 'banner') => {
    setImageUrlField(field)
    setImageUrlDraft(profileTagRows.find((r) => r.tag[0] === field)?.tag[1] ?? '')
  }

  const applyImageUrlDraft = () => {
    if (!imageUrlField) return
    const v = imageUrlDraft.trim()
    setProfileTagRows((prev) => {
      const idx = prev.findIndex((row) => row.tag[0] === imageUrlField)
      return idx >= 0
        ? prev.map((row, i) =>
            i === idx ? { ...row, tag: [imageUrlField, v, ...row.tag.slice(2)] } : row
          )
        : [...prev, { id: newEditorId(), tag: [imageUrlField, v] }]
    })
    setHasChanged(true)
    setImageUrlField(null)
  }

  const onBannerUploadSuccess = ({ url }: { url: string }) => {
    setProfileTagRows((prev) => {
      const idx = prev.findIndex((row) => row.tag[0] === 'banner')
      return idx >= 0
        ? prev.map((row, i) =>
            i === idx ? { ...row, tag: ['banner', url, ...row.tag.slice(2)] } : row
          )
        : [...prev, { id: newEditorId(), tag: ['banner', url] }]
    })
    setHasChanged(true)
  }

  const onAvatarUploadSuccess = ({ url }: { url: string }) => {
    setProfileTagRows((prev) => {
      const idx = prev.findIndex((row) => row.tag[0] === 'picture')
      return idx >= 0
        ? prev.map((row, i) =>
            i === idx ? { ...row, tag: ['picture', url, ...row.tag.slice(2)] } : row
          )
        : [...prev, { id: newEditorId(), tag: ['picture', url] }]
    })
    setHasChanged(true)
  }

  // ─── Save ─────────────────────────────────────────────────────────────────────

  const save = () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)

    const savePromise = (async () => {
      try {
        const { contentJson, orderedTags } = profileTagsToSavePayload(profileTagRows)
        const draft = createProfileDraftEvent(contentJson, orderedTags)
        const published = await publish(draft)
        await updateProfileEvent(published)
        if (!mountedRef.current) return
        setHasChanged(false)
        pop()
      } catch {
        if (mountedRef.current) setHasChanged(true)
        throw new Error(t('Failed to publish profile'))
      } finally {
        savingRef.current = false
        if (mountedRef.current) setSaving(false)
      }
    })()

    toastPublishPromise(savePromise, {
      loading: t('Saving…'),
      success: t('Profile updated'),
      error: () => t('Failed to publish profile')
    })
  }

  const saveFullProfile = async () => {
    let parsed: { kind?: number; content?: string; tags?: string[][] }
    try {
      const raw = JSON.parse(profileEventJson.trim())
      if (raw === null || typeof raw !== 'object') throw new Error('Must be a JSON object')
      parsed = raw
      if (parsed.kind !== 0) throw new Error('kind must be 0')
      if (typeof parsed.content !== 'string') throw new Error('content must be a string')
      if (!Array.isArray(parsed.tags)) throw new Error('tags must be an array')
      parsed.tags.forEach((tag: unknown, i: number) => {
        if (!Array.isArray(tag)) throw new Error(`tag at index ${i} must be an array`)
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Invalid profile JSON'))
      return
    }
    setSavingFullProfile(true)
    try {
      const profileDraftEvent = createProfileDraftEvent(parsed.content!, parsed.tags ?? [])
      const newProfileEvent = await publish(profileDraftEvent)
      await updateProfileEvent(newProfileEvent)
      setProfileEventJson(JSON.stringify(newProfileEvent, null, 2))
      setHasChanged(false)
      toast.success(t('Profile updated'))
    } catch {
      toast.error(t('Failed to publish profile'))
    } finally {
      setSavingFullProfile(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <SecondaryPageLayout ref={ref} index={index} title={profile.username} controls={refreshCacheControl}>
      {/* Banner & avatar uploaders */}
      <div className="relative isolate mb-2 bg-cover bg-center">
        {/* Banner under avatar in stacking order; fetchPriority still loads the pic first. */}
        <Uploader
          onUploadSuccess={onBannerUploadSuccess}
          onUploadStart={() => setUploadingBanner(true)}
          onUploadEnd={() => setUploadingBanner(false)}
          className="relative z-0 w-full cursor-pointer overflow-hidden"
          accept={PROFILE_IMAGE_VIDEO_UPLOADER_ACCEPT}
          maxCompressedSizeMb={5}
        >
          <ProfileBanner
            banner={banner}
            pubkey={account.pubkey}
            className="w-full aspect-[3/1]"
            imageFetchPriority="low"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30">
            {uploadingBanner ? (
              <Skeleton className="size-9 shrink-0 rounded-md" aria-hidden />
            ) : (
              <Upload size={36} />
            )}
          </div>
        </Uploader>
        <Uploader
          onUploadSuccess={onAvatarUploadSuccess}
          onUploadStart={() => setUploadingAvatar(true)}
          onUploadEnd={() => setUploadingAvatar(false)}
          className="absolute bottom-0 left-4 z-20 h-24 w-24 translate-y-1/2 cursor-pointer rounded-full border-4 border-background md:h-48 md:w-48"
          accept={PROFILE_IMAGE_VIDEO_UPLOADER_ACCEPT}
          maxCompressedSizeMb={2}
        >
          <div className="h-full w-full overflow-hidden rounded-full bg-muted">
            {isVideo(avatar) ? (
              <video
                src={avatar}
                className="h-full w-full object-cover object-center"
                autoPlay
                muted
                loop
                playsInline
                fetchPriority="high"
              />
            ) : (
              <Avatar className="h-full w-full">
                <AvatarImage
                  src={avatar}
                  className="object-cover object-center"
                  fetchPriority="high"
                  loading="eager"
                />
                <AvatarFallback>
                  <img src={defaultImage} alt="" />
                </AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-muted/30">
            {uploadingAvatar ? (
              <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
            ) : (
              <Upload />
            )}
          </div>
        </Uploader>
      </div>

      <div className="pt-14 px-4 pb-16 flex flex-col gap-4 max-sm:pb-24">
        {/* ── Unified tag list ── */}
        <Item>
          <Label className="text-muted-foreground">{t('Tag list')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('profileEditorTagListHint', {
              defaultValue:
                'All profile fields as tags. Drag rows to reorder; tag order is saved on publish. The first of each known field also populates the content JSON.'
            })}
          </p>
          <EditorSortableList
            itemIds={profileTagRows.map((row) => row.id)}
            onReorder={reorderProfileTagRows}
            className="space-y-1.5"
          >
            {profileTagRows.map((row) => {
              const tag = row.tag
              const name = tag[0] ?? ''
              const value = tag[1] ?? ''
              const isSingleton = SINGLETON_NAMES.includes(name)
              const isKnown = KNOWN_NAMES.includes(name)
              const isPic = name === 'picture'
              const isBan = name === 'banner'

              if (isPic || isBan) {
                return (
                  <SortableEditorRow key={row.id} id={row.id}>
                    <ProfileImageTagRow
                      tagName={name as 'picture' | 'banner'}
                      value={value}
                      onEdit={() => openImageUrlEditor(name as 'picture' | 'banner')}
                      onInsertThumb={() => {
                        const next = insertNostrBuildThumbUrl(value)
                        if (next) {
                          updateTagValue(row.id, next)
                        }
                      }}
                      showThumbButton={isPic && canInsertNostrBuildThumb(value)}
                      t={t}
                    />
                  </SortableEditorRow>
                )
              }

              return (
                <SortableEditorRow key={row.id} id={row.id}>
                  <div className="flex flex-wrap gap-2 items-start min-w-0">
                    <div className="w-full shrink-0 sm:w-28 sm:flex-none">
                      {isKnown ? (
                        <p
                          className="text-xs font-medium text-muted-foreground pt-2 truncate"
                          title={TAG_LABELS[name] || name}
                        >
                          {TAG_LABELS[name] || name}
                        </p>
                      ) : (
                        <Input
                          value={name}
                          placeholder={t('Tag name')}
                          className="font-mono text-xs h-8"
                          onChange={(e) => updateTagName(row.id, e.target.value)}
                        />
                      )}
                    </div>

                    {name === 'about' ? (
                      <Textarea
                        className="flex-1 text-sm min-h-[5rem] resize-y"
                        value={value}
                        onChange={(e) => updateTagValue(row.id, e.target.value)}
                      />
                    ) : (
                      <Input
                        className="flex-1 font-mono text-sm"
                        value={value}
                        onChange={(e) => updateTagValue(row.id, e.target.value)}
                      />
                    )}

                    {!isSingleton && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                        onClick={() => removeTag(row.id)}
                        aria-label={t('Remove')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </SortableEditorRow>
              )
            })}
          </EditorSortableList>

            {/* Add-tag row: dropdown + single + button */}
            <div className="flex flex-wrap gap-2 pt-1 items-center min-w-0">
              <Select value={tagToAdd} onValueChange={setTagToAdd}>
                <SelectTrigger className="min-w-0 flex-1 basis-full h-8 text-sm sm:basis-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADD_TAG_OPTIONS.map((name) => (
                    <SelectItem key={name} value={name}>
                      {TAG_LABELS[name] || name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">{t('Custom tag…')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  const name = tagToAdd === '__custom__' ? '' : tagToAdd
                  addTag(name, name === 'bot' ? 'true' : '')
                }}
                aria-label={t('Add tag')}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
        </Item>

        <div className="pb-2">
          <Button
            className="w-full rounded-full"
            onClick={save}
            disabled={saving || !hasChanged}
          >
            {saving ? <Skeleton className="mx-auto h-4 w-12 rounded-md" aria-hidden /> : t('Save')}
          </Button>
        </div>

        {/* ── Full profile event JSON (collapsible) ── */}
        {profileEvent && (
          <Item>
            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger className="flex items-center gap-2 font-medium">
                <ChevronDown className="h-4 w-4 transition-transform [[data-state=open]_&]:rotate-180" />
                {t('Full profile event')}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-4">
                <div>
                  <Label htmlFor="profile-event-json" className="text-muted-foreground">
                    {t('Event (JSON)')}
                  </Label>
                  <Textarea
                    id="profile-event-json"
                    className="mt-1 font-mono text-xs min-h-64"
                    value={profileEventJson}
                    onChange={(e) => {
                      setProfileEventJson(e.target.value)
                      setHasChanged(true)
                    }}
                    placeholder='{"id":"...","pubkey":"...","created_at":0,"kind":0,"tags":[],"content":"{}","sig":"..."}'
                  />
                </div>
                <Button
                  onClick={saveFullProfile}
                  disabled={savingFullProfile || !hasChanged}
                  className="gap-2"
                >
                  {savingFullProfile && (
                    <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />
                  )}
                  {savingFullProfile ? t('Saving…') : t('Save full profile')}
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </Item>
        )}

        {/* ── Payment info (kind 10133) ── */}
        <Item>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-muted-foreground shrink-0">{t('Payment info')} (kind 10133)</Label>
            <Button variant="outline" size="sm" onClick={openPaymentInfoEditor} className="shrink-0">
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {paymentInfoEvent ? t('Edit payment info') : t('Add payment info')}
            </Button>
          </div>
        </Item>
      </div>

      {/* ── Dialogs ── */}

      {/* Edit picture/banner URL */}
      <Dialog
        open={imageUrlField !== null}
        onOpenChange={(open) => {
          if (!open) setImageUrlField(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {imageUrlField === 'picture'
                ? t('profileEditorEditPictureUrl', { defaultValue: 'Edit profile picture URL' })
                : t('profileEditorEditBannerUrl', { defaultValue: 'Edit banner URL' })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="profile-image-url-draft">{t('URL')}</Label>
            <Input
              id="profile-image-url-draft"
              className="font-mono text-sm"
              value={imageUrlDraft}
              onChange={(e) => setImageUrlDraft(e.target.value)}
              placeholder="https://"
            />
            <p className="text-xs text-muted-foreground">
              {t('profileEditorImageUrlHint', {
                defaultValue:
                  'Saved in kind 0 tags as picture or banner. You can paste a link from a previous upload instead of using the uploader above.'
              })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImageUrlField(null)}>
              {t('Cancel')}
            </Button>
            <Button onClick={applyImageUrlDraft}>{t('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit payment info */}
      <Dialog open={paymentInfoEditOpen} onOpenChange={setPaymentInfoEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('Edit payment info')} (kind 10133)</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-4 pb-6">
            <Item>
              <Label className="text-muted-foreground">{t('Payment methods')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('paytoEditor.intro', {
                  defaultValue:
                    'Choose a payment type, then enter the address or username shown in the hint below each field. Drag rows to reorder payto tags on save.'
                })}
              </p>
              <div className="space-y-3">
              <EditorSortableList
                itemIds={paymentInfoEditMethods.map((row) => row.id)}
                onReorder={(from, to) => {
                  setPaymentInfoEditMethods((prev) => arrayMove(prev, from, to))
                }}
                className="space-y-3"
              >
                {paymentInfoEditMethods.map((row) => (
                  <SortableEditorRow key={row.id} id={row.id}>
                    <PaymentMethodRow
                      row={row}
                      onChange={(next) => {
                        setPaymentInfoEditMethods((prev) =>
                          prev.map((m) => (m.id === row.id ? { ...m, ...next } : m))
                        )
                      }}
                      onRemove={() =>
                        setPaymentInfoEditMethods((prev) => prev.filter((m) => m.id !== row.id))
                      }
                    />
                  </SortableEditorRow>
                ))}
              </EditorSortableList>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() =>
                    setPaymentInfoEditMethods((prev) => [
                      ...prev,
                      { id: newEditorId(), type: 'lightning', authority: '' }
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('Add payment method')}
                </Button>
              </div>
            </Item>
            <Item>
              <Label className="text-muted-foreground">{t('Event (JSON)')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('paytoEditor.jsonPreviewHint', {
                  defaultValue:
                    'Live preview of the kind 10133 event that will be published. Payto tag order matches the list above.'
                })}
              </p>
              <pre className="mt-2 p-3 rounded-md bg-muted text-xs overflow-auto max-h-64 break-all whitespace-pre-wrap border font-mono">
                {paymentInfoPreviewJson}
              </pre>
            </Item>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentInfoEditOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="button" onClick={savePaymentInfo} disabled={savingPaymentInfo} className="gap-2">
              {savingPaymentInfo && <Skeleton className="size-4 shrink-0 rounded-sm" aria-hidden />}
              {savingPaymentInfo ? t('Saving…') : t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SecondaryPageLayout>
  )
})
ProfileEditorPage.displayName = 'ProfileEditorPage'
export default ProfileEditorPage

// ─── Pure helpers (no React) ──────────────────────────────────────────────────

type EditorTagRow = { id: string; tag: string[] }
type EditorPaymentMethodRow = { id: string; type: string; authority: string }

function newEditorId(): string {
  return crypto.randomUUID()
}

function tagRowsFromTags(tags: string[][]): EditorTagRow[] {
  return tags.map((tag) => ({ id: newEditorId(), tag }))
}

/** Valid tags + content JSON from editor rows (tag list order is preserved). */
function profileTagsToSavePayload(rows: EditorTagRow[]): {
  contentJson: string
  orderedTags: string[][]
} {
  const validTags = rows
    .map((row) => row.tag)
    .filter((t) => {
      if (!Array.isArray(t) || !(t[0] ?? '').trim()) return false
      const name = (t[0] ?? '').trim()
      if (name === 'bot') return true
      return t.length >= 2 && (t[1] ?? '').trim()
    })
    .map((t) => {
      const name = (t[0] ?? '').trim()
      const v1 = (t[1] ?? '').trim()
      if (name === 'bot') {
        if (t.length === 1 || !v1) return ['bot']
        const low = v1.toLowerCase()
        if (low === 'false') return ['bot', 'false']
        if (low === 'true') return ['bot', 'true']
        return ['bot', v1]
      }
      return [name, v1, ...t.slice(2)]
    })

  const orderedTags = validTags.filter((() => {
    const seen = new Set<string>()
    return (t: string[]) => {
      if (!AT_MOST_ONE_NAMES.includes(t[0])) return true
      if (seen.has(t[0])) return false
      seen.add(t[0])
      return true
    }
  })())

  const content: Record<string, string> = {}
  const seenContent = new Set<string>()
  for (const tag of orderedTags) {
    const name = tag[0]
    if (name === 'bot') continue
    if (DISPLAY_ORDER.includes(name) && !seenContent.has(name)) {
      content[name] = tag[1]
      seenContent.add(name)
    }
  }
  if (content['display_name']) content['displayName'] = content['display_name']

  return { contentJson: JSON.stringify(content), orderedTags }
}

function buildProfileEventJsonFromTagRows(baseEvent: Event, rows: EditorTagRow[]): string {
  const { contentJson, orderedTags } = profileTagsToSavePayload(rows)
  return JSON.stringify(
    { ...baseEvent, content: contentJson, tags: orderedTags },
    null,
    2
  )
}

function paymentMethodsToPaytoTags(methods: EditorPaymentMethodRow[]): string[][] {
  return methods
    .filter((m) => {
      const type = m.type.trim()
      return m.authority.trim() && type && type !== PAYTO_EDITOR_OTHER_OPTION
    })
    .map((m) => {
      const type = m.type.trim().toLowerCase()
      const authority =
        type === 'paypal' ? normalizePaypalAuthority(m.authority) : m.authority.trim()
      return ['payto', type, authority]
    })
}

/**
 * Build the unified tag list from a stored profile event.
 *
 * Merge strategy:
 *  1. Event `tags` (non-auto) in event order (top to bottom).
 *  2. Content JSON fields not already covered (DISPLAY_ORDER for known keys).
 *  3. Empty placeholder rows for any singleton still missing after steps 1–2.
 */
function buildTagListFromEvent(event: Event | null): string[][] {
  let content: Record<string, unknown> = {}
  if (event?.content) {
    try { content = JSON.parse(event.content) } catch { /* ignore */ }
  }

  const normalizeTagName = (n: string) =>
    n === 'displayName' ? 'display_name' : n === 'username' ? 'name' : n

  const result: string[][] = []
  const dedup = new Set<string>()
  const singletonNamesFromTags = new Set<string>()

  const push = (tag: string[]) => {
    const name = tag[0]
    if (SINGLETON_NAMES.includes(name)) {
      if (dedup.has(name)) return
      dedup.add(name)
      singletonNamesFromTags.add(name)
    } else {
      const key = `${name}\0${tag[1] ?? ''}`
      if (dedup.has(key)) return
      dedup.add(key)
    }
    result.push([...tag])
  }

  for (const rawTag of event?.tags ?? []) {
    if (!Array.isArray(rawTag) || AUTO_NAMES.has(rawTag[0])) continue
    const norm = normalizeTagName(rawTag[0])
    const tag =
      norm !== rawTag[0] ? [norm, ...rawTag.slice(1)] : ([...rawTag] as string[])
    push(tag)
  }

  for (const name of DISPLAY_ORDER) {
    if (AUTO_NAMES.has(name) || name === 'bot') continue
    const rawVal = content[name]
    if (typeof rawVal !== 'string' || !rawVal.trim()) continue
    if (SINGLETON_NAMES.includes(name) && singletonNamesFromTags.has(name)) continue
    push([name, rawVal.trim()])
  }

  for (const [rawKey, val] of Object.entries(content)) {
    if (typeof val !== 'string' || !val.trim()) continue
    const name = normalizeTagName(rawKey)
    if (AUTO_NAMES.has(name) || DISPLAY_ORDER.includes(name)) continue
    push([name, val.trim()])
  }

  for (const name of SINGLETON_NAMES) {
    if (!result.some((t) => t[0] === name)) push([name, ''])
  }

  return result
}

// nostr.build thumb helpers are provided by @/lib/nostr-build.
// Thin local aliases keep the JSX call-sites readable.
const canInsertNostrBuildThumb = canUseNostrBuildThumb
function insertNostrBuildThumbUrl(url: string): string | null {
  if (!canUseNostrBuildThumb(url)) return null
  return toNostrBuildThumbUrl(url)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileImageTagRow({
  tagName,
  value,
  onEdit,
  onInsertThumb,
  showThumbButton,
  t
}: {
  tagName: 'picture' | 'banner'
  value: string
  onEdit: () => void
  onInsertThumb: () => void
  showThumbButton: boolean
  t: (key: string, opts?: { defaultValue?: string }) => string
}) {
  const label = TAG_LABELS[tagName] || tagName
  return (
    <div className="flex flex-wrap gap-2 items-center min-w-0">
      <p className="w-full shrink-0 text-xs font-medium text-muted-foreground truncate sm:w-28" title={label}>
        {label}
      </p>
      <Input
        readOnly
        value={value}
        className="flex-1 font-mono text-sm bg-muted/40"
        tabIndex={-1}
        title={value || undefined}
      />
      {showThumbButton && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={onInsertThumb}
          title={t('profileEditorNostrBuildThumbHint', {
            defaultValue: 'Use nostr.build thumbnail URL (/thumb/…)'
          })}
          aria-label={t('profileEditorNostrBuildThumbHint', {
            defaultValue: 'Use nostr.build thumbnail URL (/thumb/…)'
          })}
        >
          <Fingerprint className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground"
        onClick={onEdit}
        aria-label={t('Edit')}
        title={t('Edit')}
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </div>
  )
}

function Item({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2">{children}</div>
}
